/* Côté Premiere, 2.6 : J-cut / L-cut, coupes recalées sur les blancs, crédits audio, export en
   lot vers Media Encoder, médias utilisés (archive). */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

// Deux plans qui se suivent (0-10 s, 10-20 s), chacun avec son son, pris au milieu des rushs
// (2 s de poignée avant et après).
function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item, audioItem } = env;
  const v1 = seq.videoTracks[0].add(new Item(seq, media, 0, 250 * F, 50 * F));
  const v2 = seq.videoTracks[0].add(new Item(seq, media2, 250 * F, 500 * F, 50 * F));
  const a1 = seq.audioTracks[0].add(audioItem(seq, media, 0, 250 * F, 50 * F));
  const a2 = seq.audioTracks[0].add(audioItem(seq, media2, 250 * F, 500 * F, 50 * F));
  v1.setSelected(true); v2.setSelected(true);
  return Object.assign(env, { v1, v2, a1, a2 });
}

test('splitEdits: J-cut (the next sound comes early), undo puts it back', () => {
  const env = setup(), F = env.F;
  const r = env.call('splitEdits', { mode: 'j', frames: 12 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.done, 1);
  assert.strictEqual(env.a1._e, 238 * F, 'previous sound ends 12 frames early');
  assert.strictEqual(env.a2._s, 238 * F, 'next sound starts 12 frames early');
  assert.strictEqual(env.a2._in, 38 * F, 'with 12 more frames of its own media');
  assert.strictEqual(env.v2._s, 250 * F, 'the picture does not move');
  env.call('undo', { entries: r.created });
  assert.deepStrictEqual([env.a1._e, env.a2._s, env.a2._in], [250 * F, 250 * F, 50 * F]);
});

test('splitEdits: L-cut (the previous sound carries on), limited by the media handle', () => {
  const env = setup(), F = env.F;
  const r = env.call('splitEdits', { mode: 'l', frames: 12 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(env.a1._e, 262 * F);
  assert.strictEqual(env.a2._s, 262 * F);
  env.call('undo', { entries: r.created });
  assert.deepStrictEqual([env.a1._e, env.a2._s], [250 * F, 250 * F]);
  // Pas assez de média avant le 2e plan : raccord raccourci (2 s de poignée = 50 images).
  const r2 = env.call('splitEdits', { mode: 'j', frames: 80 });
  assert.strictEqual(env.a2._s, 200 * F, 'J-cut capped by the 50 frames available');
  assert.ok(r2.ok);
  assert.match(env.call('splitEdits', { mode: 'j', frames: 5, x: (env.v2.setSelected(false), 0) }).error, /deux plans/);
});

test('cutList and rollEdits: the cut moves on picture and sound, undo puts it back', () => {
  const env = setup(), F = env.F;
  const l = env.call('cutList', {});
  assert.ok(l.ok, l.error);
  assert.strictEqual(l.cuts.length, 1);
  assert.strictEqual(l.cuts[0].t, 10);
  assert.strictEqual(l.cuts[0].a.out, 12);
  assert.strictEqual(l.cuts[0].b.inP, 2);
  const r = env.call('rollEdits', { moves: [{ t: 10, to: 10.4 }] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.moved, 1);
  assert.deepStrictEqual([env.v1._e, env.v2._s, env.a1._e, env.a2._s].map(x => x / F), [260, 260, 260, 260]);
  assert.strictEqual(env.v2._in, 60 * F, 'the next shot starts later in its media');
  env.call('undo', { entries: r.created });
  assert.deepStrictEqual([env.v1._e, env.v2._s, env.a1._e, env.a2._s].map(x => x / F), [250, 250, 250, 250]);
});

test('audioCredits: sounds grouped by file', () => {
  const env = setup(), F = env.F;
  env.seq.audioTracks[1].add(env.audioItem(env.seq, env.song, 0, 500 * F, 0));
  const r = env.call('audioCredits', {});
  assert.ok(r.ok, r.error);
  const song = r.items.find(i => i.name === 'song.wav');
  assert.ok(song && song.uses === 1 && song.seconds === 20 && song.tracks === 'A2');
  assert.strictEqual(r.items.length, 3);
});

test('exportQueue: one file per sequence, extension from the preset', () => {
  const env = setup();
  const r = env.call('exportQueue', { preset: '/p/ProRes 422.epr', dir: '/exports', items: [{ id: env.seq.sequenceID, file: 'Client_Clip_16x9_v01' }, { id: 'nope', file: 'x' }] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.queued.map(q => q.file), ['Client_Clip_16x9_v01.mov']);
  assert.strictEqual(r.failed.length, 1);
  assert.strictEqual(env.encoder.jobs[0].out, '/exports/Client_Clip_16x9_v01.mov');
  assert.ok(env.encoder.started);
});

test('usedMedia: only media used in a sequence, once each', () => {
  const env = setup();
  const r = env.call('usedMedia', {});
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.files.map(f => f.path).sort(), ['/rushs/A001.mov', '/rushs/B002.mov']);
  assert.strictEqual(r.project, '/projets/Projet test.prproj');
});
