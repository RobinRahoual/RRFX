/* Côté Premiere : musique baissée sous la voix, niveau de la voix, couleur, 9:16 qui suit le visage. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv, TICKS } = require('./sim');
const db = v => 20 * Math.log10(v) + 15;

test('duckMusic: volume keys relative to the current level, undo puts it back', () => {
  const env = makeEnv(25);
  const { seq, F, song } = env;
  const m = seq.audioTracks[1].add(env.audioItem(seq, song, 50 * F, 550 * F, 100 * F, 'song'));
  m.components[0].properties[1].v = Math.pow(10, (-3 - 15) / 20); // musique à -3 dB
  const r = env.call('duckMusic', { track: 1, start: 2, keys: [[3, 0], [3.25, -12], [6, -12], [6.5, 0]] });
  assert.ok(r.ok, r.error);
  const p = m.components[0].properties[1];
  assert.strictEqual(p.keys.length, 4);
  // Temps du clip : son point d'entrée (4 s) + écart depuis son début (2 s).
  assert.strictEqual(p.keys[1].t, Math.round((4 + 1.25) * TICKS));
  assert.ok(Math.abs(db(p.keys[0].v) + 3) < 1e-6 && Math.abs(db(p.keys[1].v) + 15) < 1e-6);
  const u = env.call('undo', { entries: r.created });
  assert.strictEqual(u.removed, 1);
  assert.ok(!p.isTimeVarying() && Math.abs(db(p.getValue()) + 3) < 1e-6);
  assert.ok(!env.call('duckMusic', { track: 0, start: 2, keys: [] }).ok);
});

test('voiceLevel: each clip brought to its gain, DeNoise added, animated volume left alone', () => {
  const env = makeEnv(25);
  const { seq, F, media, media2 } = env;
  const a = seq.audioTracks[0].add(env.audioItem(seq, media, 0, 100 * F, 0));
  const b = seq.audioTracks[0].add(env.audioItem(seq, media2, 100 * F, 200 * F, 0));
  b.components[0].properties[1].setTimeVarying(true);
  const r = env.call('voiceLevel', { clips: [{ track: 0, start: 0, gain: 6 }, { track: 0, start: 4, gain: -2 }], denoise: ['Nope', 'DeNoise'] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.done, r.cleaned], [1, 1]);
  assert.ok(Math.abs(db(a.components[0].properties[1].getValue()) - 6) < 1e-6);
  assert.ok(a.components.some(c => c.displayName === 'DeNoise'));
  assert.ok(r.warnings.some(w => /anim/.test(w)));
});

test('a colour setting (Tint) is set with setColorValue', () => {
  const env = makeEnv(25);
  const r = env.call('placeTitle', { mogrt: '/t/a.mogrt', start: 1, end: 2, text: 'ARGENT', minTrack: 1,
    fx: [{ type: 'tint', names: ['Tint'], matchName: 'AE.ADBE Tint', props: [{ key: 'white', index: 1, color: true, static: [255, 210, 0] }, { key: 'amount', index: 2, static: 100 }] }] });
  assert.ok(r.ok, r.error);
  const it = env.seq.videoTracks[r.track].items[0], tint = it.components.find(c => c.matchName === 'AE.ADBE Tint');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(tint.properties[1].v)), [255, 255, 210, 0]);
});

test('9:16 copy that follows the face: filled, then Motion position keyed to keep the face centred', () => {
  const env = makeEnv(25);
  const { seq, F, media } = env;
  seq.videoTracks[0].add(new env.Item(seq, media, 0, 100 * F, 0));
  const r = env.call('formatCopy', { width: 1080, height: 1920, label: '9:16', mode: 'face', faces: [{ track: 0, start: 0, keys: [[0, 0.3, 0.4], [2, 0.7, 0.4], [3.9, 0.95, 0.4]] }] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.filled, r.faced], [1, 1]);
  const it = env.ctx.app.project.activeSequence.videoTracks[0].items[0];
  const motion = it.components.find(c => c.matchName === 'AE.ADBE Motion');
  assert.ok(Math.abs(motion.properties[1].getValue() - 177.78) < 0.01);
  const keys = motion.properties[0].keys, sw = 177.78 / 100 * 1920 / 1080;
  assert.strictEqual(keys.length, 3);
  // Visage à 30 % : image décalée vers la droite pour le ramener au centre.
  assert.ok(Math.abs(keys[0].v[0] - (0.5 - (0.3 - 0.5) * sw)) < 0.01, JSON.stringify(keys[0].v));
  assert.ok(Math.abs(keys[1].v[0] - (0.5 - 0.2 * sw)) < 0.01);
  // Visage au bord : bloqué pour ne jamais montrer de noir.
  assert.ok(Math.abs(keys[2].v[0] - (0.5 - (sw - 1) / 2)) < 0.01, JSON.stringify(keys[2].v));
  assert.strictEqual(keys[2].t, Math.round(3.9 * TICKS));
});
