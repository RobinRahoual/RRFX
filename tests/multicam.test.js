/* Multicam : son de la caméra de référence, alternance des caméras sur le rythme. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, song, Item } = env;
  env.A = seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  env.B = seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 200 * F, 20 * F));
  env.C = seq.videoTracks[1].add(new Item(seq, song, 0, 200 * F, 0, 'CAM2.mov'));
  const audio = (pi, a, b, inP, track) => { const it = new Item(seq, pi, a, b, inP); it.mediaType = 'Audio'; return seq.audioTracks[track].add(it); };
  audio(media, 0, 100 * F, 50 * F, 0);
  audio(song, 0, 600 * F, 10 * F, 1);
  return env;
}
// Plans actifs à l'instant t (en images), par piste.
const activeAt = (env, t) => env.seq.videoTracks.slice(0, 2).map((tr, i) => tr.items.filter(x => x._s <= t * env.F && t * env.F < x._e && !x.disabled).length ? i : -1).filter(i => i >= 0);

test('multicam: one camera on at a time, cycling on the beats, nothing deleted', () => {
  const env = setup();
  [env.A, env.B, env.C].forEach(x => { x.selected = true; });
  const r = env.call('multicamSwitch', { times: [1, 2, 3, 5], order: 'cycle' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.cams, 2);
  assert.strictEqual(r.segments, 5);
  assert.deepStrictEqual(r.plan, [0, 1, 0, 1, 0]);
  assert.deepStrictEqual([10, 30, 60, 80, 110, 150].map(t => activeAt(env, t)), [[0], [1], [0], [1], [1], [0]]);
  const total = env.seq.videoTracks[0].items.length + env.seq.videoTracks[1].items.length;
  assert.ok(total >= 9, 'cut on every beat, nothing removed');
  assert.ok(env.seq.videoTracks[1].items.some(x => / · RR FX off$/.test(x.name)));
  // Annuler : tout est réactivé et renommé comme avant.
  const u = env.call('undo', { entries: [r.entry] });
  assert.ok(u.ok && u.removed === 1);
  assert.ok(env.seq.videoTracks.every(tr => tr.items.every(x => !x.disabled && !/RRFX off/.test(x.name))));
});

test('multicam: random order never repeats a camera, falls back to the camera that has footage', () => {
  const env = setup();
  env.C._e = 60 * env.F; // la caméra 2 s'arrête à 2,4 s
  [env.A, env.B, env.C].forEach(x => { x.selected = true; });
  const r = env.call('multicamSwitch', { times: [0.4, 0.8, 1.2, 1.6, 2, 3, 4, 5, 6], order: 'random', seed: 7 });
  assert.ok(r.ok, r.error);
  for (let i = 1; i < r.plan.length; i++) {
    if (r.plan[i - 1] !== -1 && i < 6) assert.notStrictEqual(r.plan[i], r.plan[i - 1], 'no repeat while both cameras have footage');
  }
  assert.ok(r.plan.slice(6).every(c => c === 0), 'only camera 1 after the end of camera 2');
  // Relancer remet tout d'abord en route (pas de plans éteints en double).
  const again = env.call('multicamSwitch', { times: [2, 4], order: 'cycle' });
  assert.ok(again.ok);
  assert.ok(env.seq.videoTracks.every(tr => tr.items.every(x => !/RRFX off · RR FX off/.test(x.name))));
});

test('multicam: needs two cameras; clear all re-enables', () => {
  const env = setup();
  env.A.selected = true;
  assert.match(env.call('multicamSwitch', { times: [1], order: 'cycle' }).error, /deux caméras/);
  env.C.selected = true;
  assert.ok(env.call('multicamSwitch', { times: [1, 2], order: 'cycle' }).ok);
  const c = env.call('clearAll', { scope: 'sequence', multicam: true });
  assert.ok(c.ok && c.removed > 0);
  assert.ok(env.seq.videoTracks.every(tr => tr.items.every(x => !x.disabled)));
});

test('sync of rushes: the reference camera brings its sound on a free audio track, undo removes it', () => {
  const env = setup();
  const r = env.call('placeRushes', { items: [{ nodeId: env.media.nodeId, name: 'A001.mov', seqStart: 2, seqEnd: 6, srcIn: 1, audio: true }], minTrack: 0, label: 'RR FX · Synchro' });
  assert.ok(r.ok, r.error);
  const aud = r.created.find(e => e.kind === 'aud');
  assert.ok(aud, JSON.stringify(r));
  assert.strictEqual(aud.track, 2, 'A1 and A2 are busy: A3 added');
  const it = env.seq.audioTracks[2].items[0];
  assert.ok(it.projectItem.audioOnly);
  assert.deepStrictEqual([it._s / env.F, it._e / env.F, it._in / env.F], [50, 150, 25]);
  assert.ok(r.warnings.some(w => /A3 ajoutée/.test(w)));
  const u = env.call('undo', { entries: r.created });
  assert.strictEqual(u.removed, 2);
  assert.strictEqual(env.seq.audioTracks[2].items.length, 0);
});
