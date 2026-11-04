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
  assert.match(go().error, /une seule fois/);
  assert.match(env.call('setAdjTemplate', { path: '/modeles/Calque.prproj' }).error, /introuvable/);
  env.disk.add('/modeles/Calque.prproj');
  assert.ok(env.call('setAdjTemplate', { path: '/modeles/Calque.prproj' }).ok);
  const a = go();
  assert.ok(a.ok, a.error);
  assert.deepStrictEqual(env.imports.map(i => i.paths[0]), ['/modeles/Calque.prproj']);
  assert.ok(go().ok);
  assert.strictEqual(env.imports.length, 1, 'imported once, then found in the project');
});

test('resolve strict: only the selected clips (gradient on a text), never the clip under the playhead', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'full', strict: true, sides: ['post'], frames: 1, target: 'clip' });
  assert.ok(!r.ok, 'nothing selected → refused');
  env.v[1].setSelected(true);
  const s = env.call('resolve', { placement: 'full', strict: true, sides: ['post'], frames: 1, target: 'clip' });
  assert.ok(s.ok, s.error);
  assert.deepStrictEqual(s.targets.map(t => t.clipStart / env.F), [250]);
  env.v[1].setSelected(false);
});

test('adjustment layer template built by RR FX: first seen → exported as a project, then imported where missing', () => {
  const env = setup();
  const tpl = '/docs/RRFX/Modele calque de reglage.prproj';
  assert.ok(env.call('setAdjTemplate', { path: tpl, auto: true }).ok, 'auto: the file does not exist yet');
  const before = env.ctx.app.project.sequences.length;
  assert.ok(env.call('adjustmentInfo', {}).found);
  assert.ok(env.disk.has(tpl), 'template written');
  assert.strictEqual(JSON.stringify(env.exports.map(e => e.items)), JSON.stringify([['Calque de réglage']]));
  assert.strictEqual(env.ctx.app.project.sequences.length, before, 'temporary sequence deleted');
  assert.strictEqual(env.ctx.app.project.activeSequence.sequenceID, env.seq.sequenceID, 'original sequence still open');
  env.call('adjustmentInfo', {});
  assert.strictEqual(env.exports.length, 1, 'made once');
  // Un autre projet sans calque de réglage : le modèle est importé tout seul.
  env.root.children.splice(env.root.children.indexOf(env.adj), 1);
  const r = env.call('resolve', { placement: 'playhead', at: 100 * env.F, sides: ['post'], frames: 8, target: 'adjustment' });
  const a = env.call('apply', { target: 'adjustment', name: 'RR FX · Test', refreshAdj: true, targets: r.targets.map(t => Object.assign({}, t, { fx: [] })) });
  assert.ok(a.ok, a.error);
  assert.deepStrictEqual(env.imports.map(i => i.paths[0]), [tpl]);
});

test('gradeClips: live grading on the selected clips, one Lumetri reused, no adjustment layer', () => {
  const env = setup();
  assert.match(env.call('gradeClips', { lut: '/docs/RRFX/Looks/En direct/RRFX live a.cube', mark: 'RRFX', names: ['Lumetri Color'] }).error, /S.lectionne/);
  env.v[0].setSelected(true);
  const lumetris = () => env.v[0].components.filter(c => /Lumetri/.test(c.matchName)).length;
  const r1 = env.call('gradeClips', { lut: '/docs/RRFX/Looks/En direct/RRFX live a.cube', mark: 'RRFX', names: ['Lumetri Color'] });
  assert.ok(r1.ok, r1.error);
  assert.deepStrictEqual([r1.graded, r1.created.length, lumetris()], [1, 1, 1]);
  const r2 = env.call('gradeClips', { lut: '/docs/RRFX/Looks/En direct/RRFX live b.cube', mark: 'RRFX', names: ['Lumetri Color'] });
  assert.deepStrictEqual([r2.graded, r2.created.length, lumetris()], [1, 0, 1], 'same Lumetri, new LUT');
  assert.strictEqual(env.seq.videoTracks[1].items.length, 0, 'no adjustment layer');
  const u = env.call('undo', { entries: r1.created });
  assert.ok(u.ok, u.error);
  assert.strictEqual(lumetris(), 0, 'undo removes the Lumetri');
  env.v[0].setSelected(false);
});

test('adjustment layer found by name even with a decomposed accent (e + combining acute) or a non-clip type', () => {
  const env = setup();
  env.adj.name = 'Calque de réglage';
  env.adj.type = 4;
  const r = env.call('adjustmentInfo', {});
  assert.ok(r.found, 'decomposed accent');
  env.adj.name = 'Calque de réglage 2';
  assert.ok(env.call('adjustmentInfo', {}).found);
});

test('captureTitle: a text animated in the timeline → entry and exit, replayed on a text of another length', () => {
  const Core = require('../plugin/js/core.js'), Lib = require('../plugin/js/library.js');
  const env = setup(), F = env.F;
  const T = env.seq.videoTracks[1].add(new env.Item(env.seq, env.media, 300 * F, 400 * F, 0, 'Mon titre'));
  const put = (side, a, b) => env.call('apply', { target: 'clip', name: 'anim', targets: [{ side, clipTrack: 1, clipStart: 300 * F, start: a * F, end: b * F, name: 'anim', fx: Core.toWire(Core.compileEffect(Lib.byId['zoom-in'], {}, side, b - a, 25)) }] });
  assert.ok(put('post', 300, 310).ok);
  assert.ok(put('pre', 390, 400).ok);
  assert.match(env.call('captureTitle', {}).error, /S.lectionne/);
  T.selected = true;
  const r = env.call('captureTitle', {});
  assert.ok(r.ok, r.error);
  assert.ok(r.in && r.out, 'entry and exit found');
  assert.ok(r.in.frames >= 8 && r.in.frames <= 11 && r.out.frames >= 8 && r.out.frames <= 11, JSON.stringify([r.in.frames, r.out.frames]));
  const spec = Core.titleSpecCaptured(JSON.parse(JSON.stringify(r)), 60);
  const keyed = spec.flatMap(fx => fx.props).filter(p => p.keys && p.keys.length);
  assert.ok(keyed.length, 'keyframes replayed');
  const times = keyed.flatMap(p => p.keys.map(k => k[0]));
  assert.ok(Math.min(...times) === 0 && Math.max(...times) === 59, 'entry at the start, exit at the end of the new text: ' + Math.min(...times) + '..' + Math.max(...times));
  T.selected = false;
  const still = env.seq.videoTracks[1].add(new env.Item(env.seq, env.media, 500 * F, 560 * F, 0, 'Fixe'));
  still.selected = true;
  assert.match(env.call('captureTitle', {}).error, /images cl/);
});
