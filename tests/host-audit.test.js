/* Côté Premiere : corrections de l'audit (copies sur plusieurs pistes, rushs de même nom, vitesse
   des clips dans les images clés, annulations qui remettent l'état d'avant, séquences…). */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');

const zoom = (t, fps) => Core.toWire(Core.compileEffect(Lib.byId['zoom-in'], {}, t.side, t.frames, fps || 25));
const names = seq => seq.videoTracks.map(t => t.items.slice().sort((a, b) => a._s - b._s).map(x => x.name));

test('copies on two tracks: each copy goes right above its own clip (track inserted by the first one)', () => {
  const env = makeEnv(25), { seq, F, media, media2, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0, 'A'));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 200 * F, 0, 'B'));
  seq.videoTracks[1].add(new Item(seq, media, 0, 100 * F, 0, 'C'));
  seq.videoTracks[1].add(new Item(seq, media2, 100 * F, 200 * F, 0, 'D'));
  const r = env.call('resolve', { placement: 'cuts', scope: 'sequence', sides: ['pre', 'post'], frames: 8, target: 'copy' });
  assert.ok(r.ok, r.error);
  const res = env.call('apply', { target: 'copy', name: 'RR FX · Zoom', targets: r.targets.map(t => Object.assign({}, t, { fx: zoom(t) })) });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(names(seq).slice(0, 4), [['A', 'B'], ['RR FX · Zoom PRE', 'RR FX · Zoom POST'], ['C', 'D'], ['RR FX · Zoom PRE', 'RR FX · Zoom POST']]);
  assert.deepStrictEqual(res.created.map(c => c.track), [1, 1, 3, 3]);
  // L'annulation retrouve les quatre copies.
  assert.strictEqual(env.call('undo', { entries: res.created }).removed, 4);
});

test('two rushes with the same name from two cards: each copy comes from its own file', () => {
  const env = makeEnv(25), { seq, F, Item, projItem, bin } = env;
  const a = projItem('C0001.MP4', 1, 400 * F); a.path = '/cardA/C0001.MP4';
  const b = projItem('C0001.MP4', 1, 400 * F); b.path = '/cardB/C0001.MP4';
  bin.children.push(a, b);
  seq.videoTracks[0].add(new Item(seq, a, 0, 100 * F, 0));
  seq.videoTracks[0].add(new Item(seq, b, 100 * F, 200 * F, 0));
  seq._ph = 97 * F;
  const r = env.call('resolve', { placement: 'cut', sides: ['pre', 'post'], frames: 8, target: 'copy' });
  for (const t of r.targets) assert.ok(env.call('apply', { target: 'copy', name: 'RR FX · Z', targets: [Object.assign({}, t, { fx: zoom(t) })] }).ok);
  assert.deepStrictEqual(seq.videoTracks[1].items.slice().sort((x, y) => x._s - y._s).map(x => x.projectItem.path), ['/cardA/C0001.MP4', '/cardB/C0001.MP4']);
});

test('keyframes follow the clip speed (media time), capture reads them back in sequence time; undo restores Opacity', () => {
  const env = makeEnv(25), { seq, F, media, Item } = env;
  const it = seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 10 * F));
  it._speed = 2;
  const fx = [{ intrinsic: 'opacity', names: ['Opacity'], props: [{ index: 0, keys: [[0, 0], [4, 100]] }] }];
  const r = env.call('apply', { target: 'clip', name: 'RR FX · Fondu', targets: [{ side: 'post', start: 0, end: 10 * F, frames: 10, clipTrack: 0, clipStart: 0, clipName: 'A001.mov', fx }] });
  assert.ok(r.ok, r.error);
  const op = it.components.find(c => c.matchName === 'AE.ADBE Opacity').properties[0];
  assert.deepStrictEqual(op.keys.map(k => [k.t / F, k.v]), [[10, 0], [18, 100]], 'in point + 4 frames at 200 %');
  it.selected = true;
  const cap = env.call('capture', { includeIntrinsic: true });
  assert.ok(cap.ok, cap.error);
  assert.strictEqual(cap.frames, 5);
  const u = env.call('undo', { entries: r.created });
  assert.ok(u.ok, u.error);
  assert.deepStrictEqual([u.effects, u.skipped, op.keys, op.v], [1, 0, null, 100]);
});

test('animateTexts undo: Opacity keys put back; a replaced animation is reported, not counted as undone', () => {
  const env = makeEnv(25), { seq, F, media, Item } = env;
  const it = seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0));
  const op = it.components.find(c => c.matchName === 'AE.ADBE Opacity').properties[0];
  op.keys = [{ t: 0, v: 50 }, { t: 10 * F, v: 80 }];
  const fade = { intrinsic: 'opacity', names: ['Opacity'], props: [{ index: 0, keys: [[0, 0], [4, 100]] }] };
  const blur = { names: ['Gaussian Blur'], matchName: 'AE.ADBE Gaussian Blur 2', props: [{ index: 0, keys: [[0, 30], [4, 0]] }] };
  let r = env.call('animateTexts', { items: [{ track: 0, start: 0, fx: [fade] }] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(op.keys.map(k => k.v), [0, 100]);
  let u = env.call('undo', { entries: r.created });
  assert.deepStrictEqual([u.effects, u.skipped], [1, 0]);
  assert.deepStrictEqual(op.keys.map(k => [k.t / F, k.v]), [[0, 50], [10, 80]]);
  assert.ok(env.call('animateTexts', { items: [{ track: 0, start: 0, fx: [blur] }] }).ok);
  r = env.call('animateTexts', { replace: ['AE.ADBE Gaussian Blur 2'], items: [{ track: 0, start: 0, fx: [blur] }] });
  assert.ok(r.ok, r.error);
  u = env.call('undo', { entries: r.created });
  assert.deepStrictEqual([u.effects, u.skipped], [1, 1], 'new blur removed, the old one cannot come back');
});

test('undo of a clip effect: found by its name when a track was inserted below it since', () => {
  const env = makeEnv(25), { seq, F, media, Item } = env;
  const it = seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0));
  const fx = [{ names: ['Gaussian Blur'], matchName: 'AE.ADBE Gaussian Blur 2', props: [{ index: 0, static: 20 }] }];
  const r = env.call('apply', { target: 'clip', name: 'RR FX · Flou', targets: [{ side: 'post', start: 0, end: 10 * F, frames: 10, clipTrack: 0, clipStart: 0, clipName: 'A001.mov', fx }] });
  assert.ok(r.ok, r.error);
  env.ctx.qe.project.getActiveSequence().addTracks(1, 0, 0);
  assert.strictEqual(seq.videoTracks[1].items[0], it);
  const u = env.call('undo', { entries: r.created });
  assert.deepStrictEqual([u.effects, u.skipped], [1, 0]);
  assert.ok(!it.components.some(c => c.matchName === 'AE.ADBE Gaussian Blur 2'));
});

test('speed refused by Premiere: no copy or ramp piece left behind', () => {
  const env = makeEnv(25), { seq, F, media, Item } = env;
  const qp = env.ctx.qe.project, orig = qp.getActiveSequence;
  // QE qui refuse toute vitesse sous 100 %.
  qp.getActiveSequence = function () {
    const q = orig.call(this), gv = q.getVideoTrackAt;
    q.getVideoTrackAt = i => {
      const t = gv(i), gi = t.getItemAt;
      t.getItemAt = k => { const x = gi(k); if (x && x.setSpeed) { const ss = x.setSpeed; x.setSpeed = function (v) { if (v < 1) throw new Error('refus'); return ss.apply(this, arguments); }; } return x; };
      return t;
    };
    return q;
  };
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0));
  const ramp = env.call('rampApply', { track: 0, clipStart: 0, clipName: 'A001.mov', regionStart: 10 * F, anchor: 'start', pieces: [{ frames: 5, speed: 100 }, { frames: 5, speed: 50 }] });
  assert.ok(!ramp.ok);
  assert.match(ramp.error, /refus/);
  assert.ok(seq.videoTracks.slice(1).every(t => !t.items.length), 'no ramp piece left');
  const slow = seq.videoTracks[0].items[0];
  slow._speed = 0.5;
  const t = { side: 'post', start: 0, end: 8 * F, frames: 8, clipTrack: 0, clipStart: 0, clipName: 'A001.mov' };
  const r = env.call('apply', { target: 'copy', name: 'RR FX · Zoom', targets: [Object.assign({}, t, { fx: zoom(t) })] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.created.length, seq.videoTracks.slice(1).every(x => !x.items.length)], [0, true]);
  assert.ok(r.warnings.some(w => /refus/.test(w)));
});

test('Sequence.end as a ticks string: listSequences and activityPing read it', () => {
  const env = makeEnv(25), { seq, F } = env;
  seq.end = String(500 * F);
  assert.strictEqual(env.call('listSequences', {}).sequences[0].end, 20);
  assert.match(env.call('activityPing', {}).sig, new RegExp('\\|' + 500 * F + '\\|'));
  seq.end = { ticks: String(250 * F) };
  assert.strictEqual(env.call('listSequences', {}).sequences[0].end, 10);
  delete seq.end;
  assert.strictEqual(env.call('listSequences', {}).sequences[0].end, 0);
});

test('extractCopy: linked sound that followed its picture is not moved twice; frame-count display gets a real timecode', () => {
  const env = makeEnv(25), { seq, F, media, Item, audioItem } = env;
  // Premiere : deplacer l'image deplace son son lie.
  const move = Item.prototype.move;
  Item.prototype.move = function (t) {
    if (this.mediaType !== 'Audio') this.seq.audioTracks.forEach(tr => tr.items.forEach(x => { if (x._s === this._s && x._e === this._e) move.call(x, t); }));
    return move.call(this, t);
  };
  const formats = [], fmt = env.ctx.Time.prototype.getFormatted;
  env.ctx.Time.prototype.getFormatted = function (rate, f) { formats.push(f); return fmt.call(this); };
  seq.getSettings = () => ({ videoFrameRate: new env.ctx.Time(), videoDisplayFormat: 109 });
  seq.videoTracks[0].add(new Item(seq, media, 100 * F, 300 * F, 0));
  seq.audioTracks[0].add(audioItem(seq, media, 100 * F, 300 * F, 0));
  const r = env.call('extractCopy', { a: 4, b: 8 });
  assert.ok(r.ok, r.error);
  const ns = env.ctx.app.project.activeSequence;
  assert.deepStrictEqual(ns.videoTracks[0].items.map(x => [x._s / F, x._e / F]), [[0, 100]]);
  assert.deepStrictEqual(ns.audioTracks[0].items.map(x => [x._s / F, x._e / F]), [[0, 100]]);
  assert.ok(formats.length && formats.every(f => f === 101), '25 fps timecode instead of frames: ' + formats.join());
});

test('preflight: footage placed by RR FX counts as picture, adjustment layers do not', () => {
  const env = makeEnv(25), { seq, F, media, adj, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0, 'RR FX · Montage'));
  seq.videoTracks[1].add(new Item(seq, adj, 100 * F, 150 * F, 0, 'RR FX · Look'));
  seq.videoTracks[0].add(new Item(seq, media, 150 * F, 250 * F, 0, 'Outro.mov'));
  const issues = env.call('preflight', {}).issues.filter(i => /Image noire/.test(i.text));
  assert.deepStrictEqual(issues.map(i => [i.t * 25, i.text]), [[100, 'Image noire : 50 image(s) sans plan']]);
});

test('placeGrades: a job that fails is reported, the others are placed and returned for undo', () => {
  const env = makeEnv(25), { seq, F, media, media2, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 0));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 260 * F, 0));
  const qp = env.ctx.qe.project, get = qp.getVideoEffectByName;
  let calls = 0;
  qp.getVideoEffectByName = function (n) { return ++calls === 1 ? { name: 'cassé' } : get.call(this, n); };
  const r = env.call('placeGrades', { layer: 'conversion', groups: [
    { name: 'RR FX · Conversion Sony', lutPath: '/l/sony.cube', spans: [{ a: 0, b: 100 * F, top: 0 }] },
    { name: 'RR FX · Conversion Apple', lutPath: '/l/apple.cube', spans: [{ a: 100 * F, b: 260 * F, top: 0 }] }
  ] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.created.length, r.lutSet], [2, 1]);
  assert.ok(r.warnings.some(w => /^RR FX · Conversion Sony : /.test(w)), r.warnings.join(' | '));
});

test('audio-only media: its length is read from the audio out point', () => {
  const env = makeEnv(25), { seq, F, media, projItem, bin, audioItem } = env;
  const T = t => { const x = new env.ctx.Time(); x.ticks = String(t); return x; };
  const sfx = projItem('boom.wav', 1, 90 * F); sfx.path = '/sfx/boom.wav';
  sfx.getOutPoint = function (type) { return T(type === 1 ? 0 : this._outP); };
  bin.children.push(sfx);
  seq.audioTracks[0].add(audioItem(seq, media, 60 * F, 200 * F, 0));
  const r = env.call('placeAsset', { kind: 'audio', path: '/sfx/boom.wav', times: [0] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.created.map(c => c.track), [1], '90 frames do not fit before the clip on A1');
});

test('adjustment layer and volume in other languages; DeNoise added by voiceLevel is undone', () => {
  const env = makeEnv(25), { seq, F, media, adj } = env;
  for (const n of ['調整レイヤー', '조정 레이어', 'Корректирующий слой', '调整图层', '調整圖層']) {
    adj.name = n;
    assert.ok(env.call('adjustmentInfo', {}).found, n);
  }
  const a = seq.audioTracks[0].add(env.audioItem(seq, media, 0, 100 * F, 0));
  a.components[0].displayName = 'Громкость';
  a.components[0].properties.forEach(p => { p.displayName = '?'; });
  const r = env.call('voiceLevel', { clips: [{ track: 0, start: 0, gain: 6 }], denoise: ['DeNoise'] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.done, r.cleaned], [1, 1]);
  assert.deepStrictEqual(r.created.map(c => c.kind), ['level', 'afx']);
  const u = env.call('undo', { entries: r.created });
  assert.deepStrictEqual([u.removed, u.effects, u.skipped], [1, 1, 0]);
  assert.ok(!a.components.some(c => c.displayName === 'DeNoise'));
});

test('a raw U+2028 / U+2029 in a request survives the trip', () => {
  const env = makeEnv(25);
  const r = env.call('addMarkers', { times: [1], name: 'a b c' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(env.seq._markers[0].name, 'a b c');
});
