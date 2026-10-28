/* Fonctions 1.3 du script Premiere (marqueurs, nettoyage, musique, montage auto, synchro,
   aperçu réel, textes, overlays), sur la timeline simulée. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, song, Item } = env;
  env.A = seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  env.B = seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 200 * F, 20 * F));
  const audio = (pi, a, b, inP, track) => { const it = new Item(seq, pi, a, b, inP); it.mediaType = 'Audio'; return seq.audioTracks[track].add(it); };
  env.audioA = audio(media, 0, 100 * F, 50 * F, 0);
  env.audioB = audio(media2, 100 * F, 200 * F, 20 * F, 0);
  env.music = audio(song, 0, 600 * F, 10 * F, 1);
  seq._ph = 97 * F;
  return env;
}

test('markers: CutFX beats added, replaced, listed; user markers kept', () => {
  const env = setup();
  env.seq._markers = [200 * env.F]; // marqueur de l'utilisateur à 8 s
  let r = env.call('addMarkers', { times: [1, 1.5, 2.02, 2.02], name: 'CutFX · temps fort' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.added, 3, 'duplicates merged');
  r = env.call('addMarkers', { times: [3, 4], replace: true, from: 0, to: 10 });
  assert.strictEqual(r.removed, 3);
  const list = env.call('markerList', {}).markers;
  assert.deepStrictEqual(list.map(m => m.t), [3, 4, 8]);
  assert.strictEqual(list[2].name, '');
});

test('clear all: every CutFX layer and marker goes, the edit stays', () => {
  const env = setup();
  const def = Lib.byId['zoom-in'];
  const res = env.call('resolve', { placement: 'cut', sides: ['pre', 'post'], frames: 8, target: 'adjustment' });
  env.call('apply', { target: 'adjustment', name: 'CutFX · Zoom in', targets: res.targets.map(t => Object.assign({}, t, { fx: Core.compileEffect(def, {}, t.side, t.frames, 25) })), refreshAdj: true });
  env.call('addMarkers', { times: [1, 2] });
  env.seq._markers.push(9 * env.F);
  const r = env.call('clearAll', { scope: 'sequence', markers: true });
  assert.deepStrictEqual([r.removed, r.markers], [2, 2]);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 0);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 2);
  assert.strictEqual(env.seq._markers.length, 1, 'user marker kept');
  assert.ok(!env.call('clearAll', { scope: 'selection' }).ok, 'selection scope needs a selection');
});

test('music: the longest audio clip, or the selected one', () => {
  const env = setup();
  let m = env.call('musicInfo', {});
  assert.deepStrictEqual([m.name, m.path, m.track, m.start, m.inPoint], ['song.wav', '/music/song.wav', 1, 0, 0.4]);
  env.audioB.selected = true;
  m = env.call('musicInfo', {});
  assert.strictEqual(m.name, 'B002.mov');
});

test('cut on the beat: selected clips and their sound razored at each beat inside them', () => {
  const env = setup();
  env.A.selected = true;
  const r = env.call('cutAtTimes', { times: [1, 2, 3.0, 50] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.cuts, 3);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 5);
  assert.strictEqual(env.seq.audioTracks[0].items.length, 5, 'linked sound cut too');
  assert.strictEqual(env.seq.audioTracks[1].items.length, 1, 'music untouched');
});

test('auto edit: project rushes placed on the beat, video only, undoable', () => {
  const env = setup();
  env.media.setInPoint(2); env.media.setOutPoint(6);
  env.setProjectSelection([env.media, env.media2, env.adj]);
  const pr = env.call('projectRushes', {});
  assert.ok(pr.ok, pr.error);
  assert.deepStrictEqual(pr.rushes.map(x => [x.name, x.inT, x.outT]), [['A001.mov', 2, 6], ['B002.mov', 0, 16]]);
  const plan = Core.planAutoEdit([0, 0.5, 1, 1.5, 2], pr.rushes.map(x => ({ id: x.nodeId, inT: x.inT, outT: x.outT })), { every: 1 });
  const r = env.call('placeRushes', { items: plan.map(p => ({ nodeId: p.id, seqStart: p.seqStart, seqEnd: p.seqEnd, srcIn: p.srcIn })), minTrack: 0 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.track, 1, 'V1 is busy: first free track');
  const placed = env.seq.videoTracks[1].items.sort((a, b) => a._s - b._s);
  // Temps arrondis à l'image (0,5 s = 12,5 images → 13) ; chaque rush repart de son point d'entrée.
  assert.deepStrictEqual(placed.map(x => [x._s / env.F, x._e / env.F, x._in / env.F]), [[0, 13, 50], [13, 25, 0], [25, 38, 50], [38, 50, 0]]);
  assert.ok(placed.every(x => x.projectItem.videoOnly && x.name === 'CutFX · Montage'));
  assert.strictEqual(env.seq.audioTracks[1].items.length, 1);
  assert.strictEqual(env.call('undo', { entries: r.created }).removed, 4);
});

test('sync: info gathers the music, the selected clips or the project rushes', () => {
  const env = setup();
  env.B.selected = true;
  let r = env.call('syncInfo', {});
  assert.strictEqual(r.music.name, 'song.wav');
  assert.deepStrictEqual(r.clips.map(c => [c.name, c.path, c.start, c.inPoint]), [['B002.mov', '/rushs/B002.mov', 4, 0.8]]);
  env.B.selected = false;
  env.setProjectSelection([env.media]);
  r = env.call('syncInfo', {});
  assert.strictEqual(r.clips.length, 0);
  assert.strictEqual(r.rushes[0].name, 'A001.mov');
});

test('sync: clips moved with their sound, refused when the place is taken', () => {
  const env = setup();
  const C = env.seq.videoTracks[0].add(new env.Item(env.seq, env.media, 300 * env.F, 340 * env.F, 0));
  let r = env.call('moveClips', { moves: [{ track: 0, start: 12, name: 'A001.mov', delta: 1.2 }] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.moved, 1);
  assert.strictEqual(C._s, 330 * env.F);
  r = env.call('moveClips', { moves: [{ track: 0, start: 4, name: 'B002.mov', delta: 5.4 }] });
  assert.strictEqual(r.moved, 0, 'would overlap the moved clip');
  assert.ok(/occupée/.test(r.warnings[0]));
  r = env.call('moveClips', { moves: [{ track: 0, start: 4, name: 'B002.mov', delta: -0.4 }] });
  assert.strictEqual(r.moved, 0, 'would overlap A');
  env.A.remove();
  env.audioA.remove();
  r = env.call('moveClips', { moves: [{ track: 0, start: 4, name: 'B002.mov', delta: -0.4 }] });
  assert.strictEqual(r.moved, 1);
  assert.strictEqual(env.B._s, 90 * env.F);
  assert.strictEqual(env.audioB._s, 90 * env.F, 'its sound followed');
});

test('real preview: frames just before and at the nearest cut are exported', () => {
  const env = setup();
  const r = env.call('grabFrames', { folder: '/tmp/cutfx', prefix: 'pv' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.files, ['/tmp/cutfx/pv0', '/tmp/cutfx/pv1']);
  assert.deepStrictEqual(env.frames.map(f => f[0] / env.F), [99, 100]);
  assert.strictEqual(r.cut, 4);
});

test('titles: template placed, trimmed, text replaced, animated, undoable', () => {
  const env = setup();
  const anim = Lib.titleById.pop;
  const fx = Core.titleSpec(anim, Core.paramDefaults(anim), 25, 7, 5, 25);
  let r = env.call('placeTitle', { mogrt: '/m/Titre.mogrt', start: 1, end: 2, text: 'Je cours', fx, spanEnd: 3 });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.warnings, []);
  const t1 = env.seq.videoTracks[r.track].items[0];
  assert.deepStrictEqual([t1.name, t1._s / env.F, t1._e / env.F], ['CutFX · Texte', 25, 50]);
  assert.strictEqual(JSON.parse(t1._mgt.properties[0].v).textEditValue, 'Je cours');
  assert.strictEqual(JSON.parse(t1._mgt.properties[0].v).fontSize, 40, 'style kept');
  const tr = t1.components.find(c => c.matchName === 'AE.ADBE Geometry2');
  assert.ok(tr && tr.properties[3].keys.length > 5, 'animated');
  r = env.call('placeTitle', { mogrt: '/m/Titre.mogrt', start: 2, end: 3, text: 'vers toi', fx, track: r.track });
  assert.ok(r.ok, r.error);
  assert.strictEqual(env.seq.videoTracks[r.track].items.length, 2);
  assert.strictEqual(env.call('undo', { entries: r.created }).removed, 1);
});

test('overlays: imported once, video only, on the cut, with fade and blend mode', () => {
  const env = setup();
  const overlay = { path: '/fx/leak.mov', name: 'leak', kind: 'video', start: 'start' };
  const r = env.call('resolve', { placement: 'cut', sides: ['pre', 'post'], frames: 10, target: 'adjustment' });
  const targets = r.targets.map(t => Object.assign({}, t, { fx: Core.toWire(Core.compileOverlay({ intensity: 70 }, t.side, t.frames, 8)) }));
  const res = env.call('apply', { target: 'overlay', name: 'CutFX · Overlay leak', overlay, targets });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.warnings, []);
  const items = env.seq.videoTracks[1].items.sort((a, b) => a._s - b._s);
  assert.deepStrictEqual(items.map(i => [i.name, i._s / env.F, i._e / env.F]), [['CutFX · Overlay leak PRE', 90, 100], ['CutFX · Overlay leak POST', 100, 110]]);
  assert.ok(items[0].projectItem.videoOnly);
  const op = items[0].components[0];
  assert.strictEqual(op.properties[1].v, 8, 'blend mode');
  assert.strictEqual(op.properties[0].keys[op.properties[0].keys.length - 1].v, 70);
  const bin = env.root.children.find(c => c.name === 'CutFX Overlays');
  assert.strictEqual(bin.children.length, 1);
  env.call('apply', { target: 'overlay', name: 'CutFX · Overlay leak', overlay, targets: [Object.assign({}, targets[0], { start: 300 * env.F, end: 310 * env.F, side: 'pre' })] });
  assert.strictEqual(bin.children.length, 1, 'imported once');
  assert.strictEqual(env.call('undo', { entries: res.created }).removed, 2);
});

test('overlay shorter than the effect is shortened, images work too', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'cut', sides: ['post'], frames: 2000, target: 'adjustment' });
  const t = Object.assign({}, r.targets[0], { fx: Core.toWire(Core.compileOverlay({}, 'post', r.targets[0].frames, null)) });
  const res = env.call('apply', { target: 'overlay', name: 'CutFX · Overlay x', overlay: { path: '/fx/short.mov', kind: 'video' }, targets: [t] });
  assert.ok(res.ok && /plus court/.test(res.warnings.join(' ')), JSON.stringify(res));
  const img = env.call('apply', { target: 'overlay', name: 'CutFX · Overlay grain', overlay: { path: '/fx/grain.png', kind: 'image' }, targets: [Object.assign({}, r.targets[0], { frames: 10, end: r.targets[0].start + 10 * env.F, fx: [] })] });
  assert.ok(img.ok, img.error);
});

test('blend mode can be learned from a clip', () => {
  const env = setup();
  env.A.components[0].properties[1].v = 12;
  env.A.selected = true;
  assert.strictEqual(env.call('readBlend', {}).value, 12);
});

test('music: the camera sound linked to the selected clip is never taken for the music', () => {
  const env = setup();
  env.music._e = 50 * env.F; // la musique est plus courte que le son de la caméra
  env.B.selected = true;
  env.audioB.selected = true; // Premiere sélectionne aussi le son lié
  const m = env.call('musicInfo', {});
  assert.strictEqual(m.name, 'song.wav');
  assert.strictEqual(env.call('syncInfo', {}).music.name, 'song.wav');
});
