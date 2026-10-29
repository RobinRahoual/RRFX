/* Côté Premiere, 2.7 : les outils de Premiere pilotés par RR FX (transitions sur les coupes,
   détection des changements de plan, piste de sous-titres). */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

// Trois plans collés (0-10, 10-20, 20-30 s) avec leur son.
function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item, audioItem } = env;
  const v = [0, 1, 2].map(i => seq.videoTracks[0].add(new Item(seq, i % 2 ? media2 : media, i * 250 * F, (i + 1) * 250 * F, 50 * F)));
  const a = [0, 1, 2].map(i => seq.audioTracks[0].add(audioItem(seq, i % 2 ? media2 : media, i * 250 * F, (i + 1) * 250 * F, 50 * F)));
  return Object.assign(env, { v, a });
}

test('nativeTransitions: Premiere transitions on every cut, sound crossfades too, undo removes them', () => {
  const env = setup(), F = env.F;
  const r = env.call('nativeTransitions', { video: 'dissolve', audio: 'power', frames: 10, scope: 'sequence' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.video, r.audio, r.cuts], [2, 2, 2]);
  const vt = env.seq.videoTracks[0]._trans, at = env.seq.audioTracks[0]._trans;
  assert.deepStrictEqual(vt.map(t => [t.name, t.at / F, t.dur / F, t.align]), [['Cross Dissolve', 250, 10, 0.5], ['Cross Dissolve', 500, 10, 0.5]]);
  assert.deepStrictEqual(at.map(t => t.name), ['Constant Power', 'Constant Power']);
  const u = env.call('undo', { entries: r.created });
  assert.ok(u.ok, u.error);
  assert.strictEqual(vt.length + at.length, 0, 'all removed');
});

test('nativeTransitions: selection only, sound only, unknown transition refused', () => {
  const env = setup();
  env.v[0].setSelected(true); env.v[1].setSelected(true);
  const r = env.call('nativeTransitions', { video: 'black', audio: '', frames: 8, scope: 'selection' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.video, 1);
  assert.strictEqual(env.seq.videoTracks[0]._trans[0].name, 'Dip to Black');
  const s = env.call('nativeTransitions', { video: '', audio: 'gain', frames: 4, scope: 'selection' });
  assert.ok(s.ok, s.error);
  assert.deepStrictEqual([s.video, s.audio], [0, 1], 'only the sound of the selected cut');
  assert.match(env.call('nativeTransitions', { video: 'nope', frames: 8, scope: 'sequence' }).error, /introuvable/);
  env.v.forEach(x => x.setSelected(false));
  assert.match(env.call('nativeTransitions', { video: 'dissolve', frames: 8, scope: 'selection' }).error, /deux plans/);
});

test('sceneEdits: markers or cuts at each change of shot, on the selection', () => {
  const env = setup();
  assert.match(env.call('sceneEdits', { action: 'cuts' }).error, /Sélectionne/);
  env.v[0].setSelected(true);
  const m = env.call('sceneEdits', { action: 'markers', sensitivity: 'high' });
  assert.ok(m.ok, m.error);
  assert.deepStrictEqual([m.found, m.action], [2, 'markers']);
  assert.deepStrictEqual(env.seq.sceneCalls[0], ['CreateMarkers', false, 'HighSensitivity']);
  const c = env.call('sceneEdits', { action: 'cuts', audio: true });
  assert.ok(c.ok, c.error);
  assert.strictEqual(c.found, 1);
  assert.deepStrictEqual(env.seq.sceneCalls[1], ['ApplyCuts', true, 'MediumSensitivity']);
});

test('nativeCaptions: the .srt becomes a Premiere caption track', () => {
  const env = setup();
  const r = env.call('nativeCaptions', { path: '/tmp/Interview.srt', start: 1.5 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.name, 'Interview.srt');
  assert.deepStrictEqual(env.seq.captionCalls[0].slice(0, 2), ['Interview.srt', 1.5]);
  assert.ok(env.imports.some(i => i.paths[0] === '/tmp/Interview.srt'));
  delete env.seq.createCaptionTrack;
  assert.match(env.call('nativeCaptions', { path: '/tmp/a.srt' }).error, /2022/);
});
