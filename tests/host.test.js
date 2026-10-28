/* Exécute plugin/jsx/host.jsx (le vrai script Premiere) contre une timeline simulée (sim.js). */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item } = env;
  const v1 = seq.videoTracks[0];
  env.A = v1.add(new Item(seq, media, 0, 100 * F, 50 * F));
  env.B = v1.add(new Item(seq, media2, 100 * F, 200 * F, 20 * F));
  seq._ph = 97 * F;
  return env;
}

function applyEffect(env, id, opts) {
  const def = Lib.byId[id];
  const r = env.call('resolve', Object.assign({ placement: 'cut', sides: ['pre', 'post'], frames: 8, target: 'adjustment' }, opts));
  assert.ok(r.ok, r.error);
  const targets = r.targets.map(t => Object.assign({}, t, { fx: Core.compileEffect(def, (opts && opts.params) || {}, t.side, t.frames, r.fps) }));
  return { r, res: env.call('apply', { target: (opts && opts.target) || 'adjustment', name: 'RR FX · ' + def.name, targets, refreshAdj: true }) };
}

test('getContext', () => {
  const env = setup();
  const r = env.call('getContext', { adj: true });
  assert.ok(r.ok && r.hasSequence);
  assert.strictEqual(r.fps, 25);
  assert.strictEqual(r.adj.name, 'Calque de réglage');
});

test('resolve: nearest cut, both sides', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'cut', sides: ['pre', 'post'], frames: 8, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.targets.length, 2);
  assert.deepStrictEqual(r.targets.map(t => [t.side, t.start / env.F, t.end / env.F, t.frames]), [['pre', 92, 100, 8], ['post', 100, 108, 8]]);
});

test('apply zoom-in on adjustment layers above V1', () => {
  const env = setup();
  const { res } = applyEffect(env, 'zoom-in');
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.warnings, []);
  const v2 = env.seq.videoTracks[1].items.sort((a, b) => a._s - b._s);
  assert.strictEqual(v2.length, 2);
  assert.deepStrictEqual(v2.map(i => [i.name, i._s / env.F, i._e / env.F]), [['RR FX · Zoom in PRE', 92, 100], ['RR FX · Zoom in POST', 100, 108]]);
  const tr = v2[0].components[2];
  assert.strictEqual(tr.matchName, 'AE.ADBE Geometry2');
  const scale = tr.properties[3];
  assert.strictEqual(scale.keys.length, 8);
  assert.strictEqual(scale.keys[0].t, 0);
  assert.strictEqual(scale.keys[7].t, 7 * env.F);
  assert.strictEqual(scale.keys[7].v, 150);
  assert.strictEqual(tr.properties[9].v, false);
  assert.strictEqual(tr.properties[10].v, 270);
  const post = v2[1].components[2].properties[3];
  assert.strictEqual(post.keys[0].v, 150);
  assert.strictEqual(post.keys[7].v, 100);
  assert.strictEqual(env.adj._outP, env.adj._dur, 'adjustment in/out restored');
});

test('second apply stacks on the next free track', () => {
  const env = setup();
  applyEffect(env, 'zoom-in');
  const { res } = applyEffect(env, 'flash-white');
  assert.ok(res.ok, res.error);
  assert.strictEqual(env.seq.videoTracks[2].items.length, 2);
  const third = applyEffect(env, 'shake').res;
  assert.ok(third.ok, third.error);
  assert.ok(third.warnings.some(w => /Piste vidéo V4 ajoutée/.test(w)), JSON.stringify(third.warnings));
});

test('point values: normalized vs pixels', () => {
  const env = setup();
  const { res } = applyEffect(env, 'slide', { sides: ['pre'] });
  assert.ok(res.ok, res.error);
  const it = env.seq.videoTracks[1].items[0];
  const offset = it.components[2];
  assert.strictEqual(offset.matchName, 'AE.ADBE Offset');
  const last = offset.properties[0].keys[7].v;
  assert.ok(Math.abs(last[0] - (0.5 - 0.6) * 1920) < 0.01 && Math.abs(last[1] - 540) < 1e-6, 'pixels: ' + last);
});

test('apply on clip (direct) + undo removes the effects', () => {
  const env = setup();
  const { res } = applyEffect(env, 'defocus', { target: 'clip' });
  assert.ok(res.ok, res.error);
  assert.strictEqual(env.A.components.length, 3);
  assert.strictEqual(env.B.components.length, 3);
  const blurA = env.A.components[2].properties[0];
  assert.strictEqual(blurA.keys[0].t, 50 * env.F + 92 * env.F, 'key time = inPoint + offset');
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.removed, 0);
  assert.strictEqual(u.effects, 2);
  assert.strictEqual(env.A.components.length, 2);
});

test('undo removes the adjustment layers it made, nothing else', () => {
  const env = setup();
  const { res } = applyEffect(env, 'zoom-in');
  env.seq.videoTracks[1].items[0].name = 'renamed by user';
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.removed, 1);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 1);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 2);
});

test('echo effect directly on the clip (legacy target)', () => {
  const env = setup();
  const { res } = applyEffect(env, 'echo-blur', { target: 'clip', sides: ['post'] });
  assert.ok(res.ok, res.error);
  const echo = env.B.components[2];
  assert.strictEqual(echo.matchName, 'AE.ADBE Echo');
  assert.strictEqual(echo.properties[0].v, -0.04);
});

test('all built-ins apply without warnings', () => {
  Lib.EFFECTS.forEach(def => {
    const env = setup();
    const { res } = applyEffect(env, def.id, { target: def.target || 'adjustment' });
    assert.ok(res.ok, def.id + ': ' + res.error);
    assert.deepStrictEqual(res.warnings, [], def.id);
  });
});

test('cuts placement over selection', () => {
  const env = setup();
  const C = env.seq.videoTracks[0].add(new env.Item(env.seq, env.media, 200 * env.F, 260 * env.F, 0));
  env.A.selected = env.B.selected = C.selected = true;
  const r = env.call('resolve', { placement: 'cuts', sides: ['pre', 'post'], frames: 6, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.targets.map(t => t.start / env.F), [94, 100, 194, 200]);
});

test('pre clamps at sequence start', () => {
  const env = setup();
  env.seq._ph = 2 * env.F;
  const r = env.call('resolve', { placement: 'playhead', sides: ['pre'], frames: 8, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.targets[0].frames, 2);
});

test('capture roundtrip', () => {
  const env = setup();
  applyEffect(env, 'zoom-spin', { sides: ['post'] });
  const it = env.seq.videoTracks[1].items[0];
  it.selected = true;
  const cap = env.call('capture', { includeIntrinsic: false });
  assert.ok(cap.ok, cap.error);
  assert.strictEqual(cap.frames, 8);
  assert.strictEqual(cap.origin, 'post');
  const tr = cap.components[0];
  assert.strictEqual(tr.matchName, 'AE.ADBE Geometry2');
  const scale = tr.props.find(p => p.index === 3);
  assert.strictEqual(scale.values.length, 8);
  assert.strictEqual(scale.values[0], 140);
  // re-apply the capture as PRE (mirrored) on clips
  it.selected = false;
  const spec = Core.compileCaptured(cap, 'pre', 10, { stretch: true, mirror: true });
  assert.strictEqual(spec[0].props.find(p => p.index === 3).values[9], 140);
  const r = env.call('resolve', { placement: 'cut', sides: ['pre'], frames: 10, target: 'adjustment' });
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX · cap', targets: r.targets.map(t => Object.assign({}, t, { fx: spec })) });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.warnings, []);
});

function rampCheck(env, placement, anchor, points, segments, extra) {
  const rr = env.call('rampResolve', { placement, frames: 12 });
  assert.ok(rr.ok, rr.error);
  const pieces = Core.rampPieces(points, rr.frames, segments);
  const res = env.call('rampApply', Object.assign({ track: rr.track, clipStart: rr.clipStart, clipName: rr.clipName, regionStart: rr.regionStart, pieces, anchor: anchor || rr.anchor, interp: 'keep' }, extra || {}));
  return { rr, pieces, res };
}

const snapshot = it => JSON.stringify([it._s, it._e, it._in, it._out, it._speed, it.components.length]);

function rampLayer(env, track) {
  return env.seq.videoTracks[track].items.filter(i => i.name === 'RR FX · Rampe').sort((a, b) => a._s - b._s);
}

test('speed ramp before the cut: on a copy layer, original untouched, cut and frame kept', () => {
  const env = setup();
  const before = [snapshot(env.A), snapshot(env.B)];
  const srcAtCut = env.A._in + (100 * env.F - env.A._s);
  const { pieces, res } = rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 6);
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual([snapshot(env.A), snapshot(env.B)], before, 'V1 untouched');
  assert.strictEqual(res.track, 1);
  const items = rampLayer(env, 1);
  assert.strictEqual(items.length, 6);
  assert.ok(Math.abs(items[0]._s - 88 * env.F) < 1);
  assert.ok(Math.abs(items[5]._e - 100 * env.F) < 1, 'ends on the cut');
  assert.ok(Math.abs(items[5]._out - srcAtCut) < 2, 'frame at the cut kept');
  for (let k = 1; k < items.length; k++) {
    assert.ok(Math.abs(items[k]._s - items[k - 1]._e) < 1, 'contiguous at ' + k);
    assert.ok(Math.abs(items[k]._in - items[k - 1]._out) < 2, 'source continuous at ' + k);
  }
  items.forEach((it, k) => assert.ok(Math.abs(it._speed - pieces[k].speed / 100) < 1e-9));
  assert.ok(items[0].projectItem.videoOnly, 'copies come from a video-only subclip');
  assert.strictEqual(res.created.length, 6);
  assert.deepStrictEqual(res.warnings, []);
});

test('ramp undo from the panel history removes every piece', () => {
  const env = setup();
  const { res } = rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 6);
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.removed, 6);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 0);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 2);
});

test('speed ramp after the cut', () => {
  const env = setup();
  env.seq._ph = 101 * env.F;
  const { res } = rampCheck(env, 'post', null, Core.RAMP_PRESETS.outOfCut.points, 4);
  assert.ok(res.ok, res.error);
  const items = rampLayer(env, 1);
  assert.strictEqual(items.length, 4);
  assert.strictEqual(items[0]._in, 20 * env.F, 'first frame after the cut kept');
  assert.ok(Math.abs(items[0]._s - 100 * env.F) < 1);
  assert.ok(Math.abs(items[3]._e - 112 * env.F) < 1);
  for (let k = 1; k < items.length; k++) assert.ok(Math.abs(items[k]._in - items[k - 1]._out) < 2);
});

test('speed ramp refuses when media is missing, and places nothing', () => {
  const env = setup();
  env.A._in = 0; env.A._out = 100 * env.F; env.A._s = 80 * env.F; env.A._e = 100 * env.F;
  const { res } = rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 6);
  assert.ok(!res.ok, 'the speed-up needs ~25 frames of media before frame 20');
  assert.ok(/Pas assez de média avant/.test(res.error), res.error);
  env.seq._ph = 101 * env.F;
  env.B._in = 390 * env.F; env.B._out = 490 * env.F;
  const after = rampCheck(env, 'post', null, Core.RAMP_PRESETS.outOfCut.points, 4).res;
  assert.ok(!after.ok && /Pas assez de média après/.test(after.error), after.error);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 0);
  assert.strictEqual(env.subclipCalls(), 0);
});

test('slow-mo ramp around the playhead', () => {
  const env = setup();
  env.seq._ph = 40 * env.F;
  const { res } = rampCheck(env, 'playhead', 'start', Core.RAMP_PRESETS.slowHit.points, 8);
  assert.ok(res.ok, res.error);
  const items = rampLayer(env, 1);
  assert.strictEqual(items.length, 8);
  assert.ok(Math.abs(items[0]._s - 34 * env.F) < 1);
  assert.ok(Math.abs(items[7]._e - 46 * env.F) < 1);
  for (let k = 1; k < items.length; k++) assert.ok(Math.abs(items[k]._in - items[k - 1]._out) < 2);
});

test('ramp: a busy track above gets a new track inserted right above the clip', () => {
  const env = setup();
  applyEffect(env, 'zoom-in', { sides: ['pre'] });
  const { res } = rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 6);
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.track, 1, 'right above V1');
  assert.strictEqual(rampLayer(env, 1).length, 6);
  assert.strictEqual(env.seq.videoTracks[2].items[0].name, 'RR FX · Zoom in PRE', 'the adjustment layer stays above the ramp');
  assert.ok(res.warnings.some(w => /insérée/.test(w)));
});

test('ramp copies the framing and effects of the clip', () => {
  const env = setup();
  env.A.components[1].properties[1].v = 130;
  const pos = env.A.components[1].properties[0];
  pos.setTimeVarying(true);
  [80, 99].forEach((fr, n) => {
    const t = { _t: env.A._in + fr * env.F };
    Object.setPrototypeOf(t, Object.getPrototypeOf(env.seq.getPlayerPosition()));
    pos.addKey(t); pos.setValueAtKey(t, n ? [0.6, 0.5] : [0.4, 0.5]);
  });
  const { res } = rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 3);
  assert.ok(res.ok, res.error);
  rampLayer(env, 1).forEach(it => {
    assert.strictEqual(it.components[1].properties[1].v, 130, 'scale copied');
    assert.strictEqual(it.components[1].properties[0].keys.length, 2, 'animated reframe copied');
  });
  const noLook = setup();
  const r2 = rampCheck(noLook, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 3, { copyLook: false });
  assert.ok(r2.res.ok);
});

test('ramp works when Premiere wants speeds in percent', () => {
  const env = setup();
  env.setSpeedPercent(true);
  const { pieces, res } = rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 4);
  assert.ok(res.ok, res.error);
  rampLayer(env, 1).forEach((it, k) => assert.ok(Math.abs(it._speed - pieces[k].speed / 100) < 1e-9));
});

test('the video-only subclip is created once and reused, in a RR FX bin', () => {
  const env = setup();
  rampCheck(env, 'pre', null, Core.RAMP_PRESETS.intoCut.points, 3);
  env.call('undo', { entries: rampCheck(setup(), 'pre', null, Core.RAMP_PRESETS.intoCut.points, 3).res.created });
  env.seq._ph = 60 * env.F;
  rampCheck(env, 'playhead', 'start', Core.RAMP_PRESETS.slowHit.points, 3);
  assert.strictEqual(env.subclipCalls(), 1);
  const rrfx = env.root.children.find(c => c.name === 'RR FX');
  assert.ok(rrfx && rrfx.children.some(c => c.name === 'RR FX · A001.mov · vidéo'));
});

test('effects on a copy of the shot: Motion blur (Echo) never touches the clip', () => {
  const env = setup();
  const before = snapshot(env.B);
  const { res } = applyEffect(env, 'echo-blur', { target: 'copy', sides: ['post'] });
  assert.ok(res.ok, res.error);
  assert.strictEqual(snapshot(env.B), before);
  const copy = env.seq.videoTracks[1].items[0];
  assert.strictEqual(copy.name, 'RR FX · Motion blur POST');
  assert.ok(Math.abs(copy._s - 100 * env.F) < 1 && Math.abs(copy._e - 108 * env.F) < 1);
  assert.strictEqual(copy._in, env.B._in, 'same source frames as the clip');
  assert.strictEqual(copy.components[copy.components.length - 1].matchName, 'AE.ADBE Echo');
  assert.strictEqual(env.call('undo', { entries: res.created }).removed, 1);
});

test('copy of a sped-up clip keeps its speed', () => {
  const env = setup();
  env.B._speed = 2; env.B._out = env.B._in + 200 * env.F;
  const { res } = applyEffect(env, 'shake', { target: 'copy', sides: ['post'] });
  assert.ok(res.ok, res.error);
  const copy = env.seq.videoTracks[1].items[0];
  assert.strictEqual(copy._speed, 2);
  assert.ok(Math.abs(copy._e - 108 * env.F) < 1);
  assert.strictEqual(copy._out - copy._in, 16 * env.F, '8 frames at 200 % = 16 frames of media');
});

test('diagnose and listEffects', () => {
  const env = setup();
  env.A.selected = true;
  assert.ok(/Motion/.test(env.call('diagnose').text));
  assert.deepStrictEqual(env.call('listEffects', { filter: 'blur' }).names, ['Gaussian Blur', 'Directional Blur']);
});

test('no adjustment layer → clear error', () => {
  const env = setup();
  env.adj.name = 'Something else';
  env.call('adjustmentInfo', {});
  const { res } = applyEffect(env, 'zoom-in');
  assert.ok(!res.ok && /calque de réglage/i.test(res.error), res.error);
});


test('markers placement: one effect per marker, limited to the selection', () => {
  const env = setup();
  env.seq._markers = [40 * env.F, 100 * env.F + 3, 150 * env.F, 250 * env.F];
  const r = env.call('resolve', { placement: 'markers', sides: ['post'], frames: 4, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.targets.map(t => t.start / env.F), [40, 100, 150, 250]);
  env.B.selected = true;
  const r2 = env.call('resolve', { placement: 'markers', sides: ['pre', 'post'], frames: 4, target: 'clip' });
  assert.ok(r2.ok, r2.error);
  assert.deepStrictEqual(r2.targets.map(t => [t.side, t.start / env.F]), [['pre', 96], ['post', 100], ['pre', 146], ['post', 150]]);
  assert.strictEqual(r2.targets[0].clipStart, env.A._s, 'PRE of the first marker sits on the outgoing clip');
});

test('markers placement without markers explains how to add them', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'markers', sides: ['post'], frames: 4, target: 'adjustment' });
  assert.ok(!r.ok && /touche M/.test(r.error), r.error);
});

test('undo removes effects added on clips when Premiere allows it', () => {
  const env = setup();
  const before = env.A.components.length;
  const { res } = applyEffect(env, 'shake-impact', { target: 'clip' });
  assert.ok(res.ok, res.error);
  assert.strictEqual(env.A.components.length, before + 2);
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.effects, 4);
  assert.strictEqual(u.skipped, 0);
  assert.strictEqual(env.A.components.length, before);
  assert.strictEqual(env.B.components.length, before);
});

test('undo leaves clip effects alone when the user changed them since', () => {
  const env = setup();
  const { res } = applyEffect(env, 'defocus', { target: 'clip', sides: ['pre'] });
  env.A.components.pop();
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.effects, 0);
  assert.strictEqual(u.skipped, 1);
});

test('undo on clips is skipped cleanly when components cannot be removed', () => {
  const env = setup();
  env.setRemovable(false);
  const { res } = applyEffect(env, 'defocus', { target: 'clip' });
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.effects, 0);
  assert.strictEqual(u.skipped, 2);
});

test('a reordered effect still animates the right parameter (name check)', () => {
  const env = setup();
  // Same Transform, but Premiere lists Rotation before Scale.
  env.setParamNames('AE.ADBE Geometry2', ['Anchor Point', 'Position', 'Uniform Scale', 'Rotation', 'Scale Width', 'Skew', 'Skew Axis', 'Scale', 'Opacity', 'Use Composition\'s Shutter Angle', 'Shutter Angle', 'Sampling']);
  const { res } = applyEffect(env, 'zoom-in', { sides: ['pre'] });
  assert.ok(res.ok, res.error);
  const tr = env.seq.videoTracks[1].items[0].components[2];
  assert.strictEqual(tr.properties[7].keys.length, 8, 'Scale (now #7) animated');
  assert.strictEqual(tr.properties[3].keys, null, 'Rotation (#3) untouched');
  assert.ok(res.warnings.some(w => /Scale/.test(w)), JSON.stringify(res.warnings));
});

test('French parameter names pass the name check', () => {
  const env = setup();
  env.setParamNames('AE.ADBE Geometry2', ['Point d\'ancrage', 'Position', 'Échelle uniforme', 'Hauteur d\'échelle', 'Largeur d\'échelle', 'Inclinaison', 'Axe d\'inclinaison', 'Rotation', 'Opacité', 'Utiliser l\'angle d\'obturateur de la composition', 'Angle d\'obturateur', 'Échantillonnage']);
  const { res } = applyEffect(env, 'zoom-spin', { sides: ['pre'] });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.warnings, []);
});

test('compat reports what this Premiere offers', () => {
  const env = setup();
  const r = env.call('compat');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.version, '1.5.1');
  assert.strictEqual(r.app, '25.6.0');
});

test('per-target names label each adjustment layer', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'cut', sides: ['pre', 'post'], frames: 4, target: 'adjustment' });
  const targets = r.targets.map((t, i) => Object.assign({}, t, { name: i ? 'RR FX · Glitch' : 'RR FX · Shake', fx: Core.compileEffect(Lib.byId[i ? 'glitch' : 'shake'], {}, t.side, t.frames, r.fps) }));
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX', targets });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(env.seq.videoTracks[1].items.map(i => i.name).sort(), ['RR FX · Glitch POST', 'RR FX · Shake PRE']);
});

test('overwriteClip that wants seconds: the stray layer is removed, the real one is placed', () => {
  const env = setup();
  env.setSecondsOnly(true);
  env.seq._ph = 197 * env.F;
  const { res } = applyEffect(env, 'zoom-in', { sides: ['pre'] });
  assert.ok(res.ok, res.error);
  const v2 = env.seq.videoTracks[1].items;
  assert.deepStrictEqual(v2.map(i => [i.name, i._s / env.F]), [['RR FX · Zoom in PRE', 192]]);
});

test('adjustment layer deleted from the project: clear error, nothing half-done', () => {
  const env = setup();
  applyEffect(env, 'zoom-in', { sides: ['pre'] });
  env.root.children.splice(env.root.children.indexOf(env.adj), 1);
  env.adj.name = 'gone';
  const before = env.seq.videoTracks[1].items.length;
  const { res } = applyEffect(env, 'shake', { sides: ['post'] });
  assert.ok(!res.ok, 'should fail');
  assert.ok(/calque de réglage/i.test(res.error), res.error);
  assert.strictEqual(env.seq.videoTracks[1].items.length + env.seq.videoTracks[2].items.length, before);
});

test('an effect that fails midway keeps what was placed (undo still finds it)', () => {
  const env = setup();
  const def = Lib.byId['zoom-in'];
  const r = env.call('resolve', { placement: 'cut', sides: ['pre'], frames: 4, target: 'adjustment' });
  const fx = Core.compileEffect(def, {}, 'pre', 4, r.fps);
  fx.push({ type: 'x', names: ['Transform'], matchName: 'AE.ADBE Geometry2', props: [{ key: 'scale', index: 3, keys: 'not-a-list' }] });
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX · test', targets: r.targets.map(t => Object.assign({}, t, { fx })) });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.created.length, 1);
  assert.ok(res.warnings.length >= 1);
  const u = env.call('undo', { entries: res.created });
  assert.strictEqual(u.removed, 1);
});

test('wire format (thinned keys) lands on the right frames', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'cut', sides: ['pre'], frames: 20, target: 'adjustment' });
  const spec = Core.compileEffect(Lib.byId.flicker, {}, 'pre', 20, r.fps);
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX · Flicker', targets: r.targets.map(t => Object.assign({}, t, { fx: Core.toWire(spec) })) });
  assert.ok(res.ok, res.error);
  const p = env.seq.videoTracks[1].items[0].components[2].properties[8];
  const full = spec[0].props.find(x => x.key === 'opacity').values;
  for (let i = 0; i < 20; i++) {
    const v = p.getValueAtTime({ _t: i * env.F, ticks: String(i * env.F) });
    assert.ok(Math.abs(v - full[i]) < 1e-6, 'frame ' + i + ': ' + v + ' vs ' + full[i]);
  }
  assert.ok(p.keys.length < 20, 'fewer keyframes than frames (' + p.keys.length + ')');
});
