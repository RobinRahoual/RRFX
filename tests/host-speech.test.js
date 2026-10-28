/* Côté Premiere : silences coupés et recollés, effets sur toute la séquence, fond flou, bandeau. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv, TICKS } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, adj, Item } = env;
  // Interview : 10 s d'image (V1) et son lié (A1) ; une musique (A2) et un titre (V3).
  const v = seq.videoTracks[0].add(new Item(seq, media, 0, 250 * F, 0));
  const a = seq.audioTracks[0].add(new Item(seq, media, 0, 250 * F, 0));
  a.mediaType = 'Audio';
  const m = seq.audioTracks[1].add(new Item(seq, media2, 0, 300 * F, 0, 'song'));
  m.mediaType = 'Audio';
  seq.videoTracks[2].add(new Item(seq, adj, 0, 80 * F, 0, 'Titre'));
  v.setSelected(true); a.setSelected(true);
  return env;
}
const span = it => [it._s, it._e].map(x => Math.round(x / (TICKS / 25)));

test('speechInfo: the selected clip with its linked sound, path and times', () => {
  const env = setup();
  const r = env.call('speechInfo', {});
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.clips.length, 1);
  assert.deepStrictEqual([r.clips[0].kind, r.clips[0].path, r.clips[0].start, r.clips[0].end], ['video', '/rushs/A001.mov', 0, 10]);
  assert.deepStrictEqual(r.tracks, { video: [0], audio: [0] });
});

test('cutSilences: gaps removed on picture and sound, the rest closed up, other tracks left alone', () => {
  const env = setup();
  const r = env.call('cutSilences', { ranges: [{ a: 2, b: 3 }, { a: 6, b: 6.4 }, { a: 9.6, b: 12 }] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.ranges, 3);
  assert.ok(Math.abs(r.seconds - 1.8) < 1e-6, r.seconds);
  const v = env.seq.videoTracks[0].items.slice().sort((p, q) => p._s - q._s).map(span);
  const a = env.seq.audioTracks[0].items.slice().sort((p, q) => p._s - q._s).map(span);
  assert.deepStrictEqual(v, [[0, 50], [50, 125], [125, 205]]);
  assert.deepStrictEqual(a, v, 'sound stays in sync');
  // La source suit : le 2e morceau reprend à 3 s du fichier.
  const second = env.seq.videoTracks[0].items.find(it => Math.round(it._s / (TICKS / 25)) === 50);
  assert.strictEqual(Math.round(second._in / (TICKS / 25)), 75);
  assert.deepStrictEqual(span(env.seq.audioTracks[1].items[0]), [0, 300], 'music untouched');
  assert.ok(r.warnings.some(w => /V3/.test(w) && /A2/.test(w)), r.warnings.join(' | '));
});

test('cutSilences on a copy: the original sequence is untouched', () => {
  const env = setup();
  const r = env.call('cutSilences', { ranges: [{ a: 2, b: 3 }], copy: true });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.name, 'Seq 01 (sans silences)');
  const ns = env.ctx.app.project.activeSequence;
  assert.notStrictEqual(ns, env.seq);
  assert.strictEqual(ns.videoTracks[0].items.length, 2);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 1, 'original kept');
  assert.deepStrictEqual(span(env.seq.videoTracks[0].items[0]), [0, 250]);
  const none = env.call('cutSilences', { ranges: [] });
  assert.ok(none.ok && none.ranges === 0);
  const env2 = setup();
  env2.seq.videoTracks[0].items[0].setSelected(false);
  env2.seq.audioTracks[0].items[0].setSelected(false);
  assert.ok(!env2.call('cutSilences', { ranges: [{ a: 1, b: 2 }] }).ok, 'needs a selection');
});

test('sound-only selection (microphone) is cut too', () => {
  const env = setup();
  env.seq.videoTracks[0].items[0].setSelected(false);
  const r = env.call('cutSilences', { ranges: [{ a: 4, b: 5 }] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(env.seq.audioTracks[0].items.length, 2);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 1, 'picture track not in the selection');
});

test('resolve scope sequence: every cut and every clip, without a selection', () => {
  const env = makeEnv(25);
  const { seq, F, media, media2, adj, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 200 * F, 0));
  seq.videoTracks[0].add(new Item(seq, media, 200 * F, 300 * F, 100 * F));
  seq.videoTracks[1].add(new Item(seq, adj, 0, 300 * F, 0, 'RR FX · Look'));
  const cuts = env.call('resolve', { placement: 'cuts', scope: 'sequence', sides: ['pre', 'post'], frames: 5 });
  assert.ok(cuts.ok, cuts.error);
  assert.strictEqual(cuts.targets.length, 4);
  assert.ok(!env.call('resolve', { placement: 'cuts', sides: ['pre'], frames: 5 }).ok, 'selection still needed without scope');
  const full = env.call('resolve', { placement: 'full', scope: 'sequence', sides: ['post'], frames: 5 });
  assert.ok(full.ok, full.error);
  assert.deepStrictEqual(full.targets.map(t => t.frames), [100, 100, 100], 'adjustment layer not a clip');
});

test('format copy on a blurred background: sharp fitted copy above, filled blurred clip below', () => {
  const env = makeEnv(25);
  const { seq, F, media, media2, adj, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 260 * F, 20 * F));
  seq.videoTracks[1].add(new Item(seq, adj, 0, 260 * F, 0, 'RR FX · Look Nuit POST'));
  const r = env.call('formatCopy', { width: 1080, height: 1920, label: '9:16', mode: 'blur', blur: ['Gaussian Blur'] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.blurred, 2);
  const ns = env.ctx.app.project.activeSequence;
  const scale = it => it.components.find(c => c.matchName === 'AE.ADBE Motion').properties[1].getValue();
  const below = ns.videoTracks[0].items, above = ns.videoTracks[1].items;
  assert.strictEqual(below.length, 2);
  assert.strictEqual(above.length, 2, 'copies on an inserted track right above');
  below.forEach(it => {
    assert.ok(Math.abs(scale(it) - 177.78) < 0.01, 'fill ' + scale(it));
    const blur = it.components.find(c => c.matchName === 'AE.ADBE Gaussian Blur 2');
    assert.ok(blur && blur.properties[0].getValue() === 60 && blur.properties[2].getValue() === true);
  });
  above.forEach(it => assert.ok(Math.abs(scale(it) - 56.25) < 0.01, 'fit ' + scale(it)));
  assert.deepStrictEqual(above.map(it => [it._s, it._e, it._in]).sort((p, q) => p[0] - q[0]), below.map(it => [it._s, it._e, it._in]).sort((p, q) => p[0] - q[0]));
  assert.ok(/Look/.test(ns.videoTracks[2].items[0].name), 'look layer stays on top');
});

test('placeTitle with a position (lower third)', () => {
  const env = makeEnv(25);
  const r = env.call('placeTitle', { mogrt: '/t/lower.mogrt', start: 1, end: 6, text: 'Camille\rDirectrice', fx: [], pos: [0.3, 0.84], minTrack: 1 });
  assert.ok(r.ok, r.error);
  const it = env.seq.videoTracks[r.track].items[0];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(it.components.find(c => c.matchName === 'AE.ADBE Motion').properties[0].getValue())), [0.3, 0.84]);
  assert.ok(/Camille\\rDirectrice/.test(it._mgt.properties[0].getValue()));
});
