/* Parcours face cam complet sur le Premiere simulé : silences coupés sur une copie, zoom visage
   un plan sur deux, musique baissée sous la voix. */
const { test } = require('node:test');
const assert = require('node:assert');
global.self = global;
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');
const F = require('../plugin/js/faces.js');
const V = require('../plugin/js/voix.js');
const { makeEnv, TICKS } = require('./sim');

test('face cam: cut silences on a copy, face zoom on every other clip, music ducked under the voice', () => {
  const env = makeEnv(25);
  const { seq, F: f, media, song } = env;
  const adjTrack = seq.videoTracks[1];
  adjTrack.add(new env.Item(seq, env.adj, 0, 250 * f, 0, 'Calque de réglage'));
  adjTrack.items.length = 0; // le calque de réglage du projet reste dans le chutier
  const v = seq.videoTracks[0].add(new env.Item(seq, media, 0, 250 * f, 0));
  const a = seq.audioTracks[0].add(env.audioItem(seq, media, 0, 250 * f, 0));
  seq.audioTracks[1].add(env.audioItem(seq, song, 0, 300 * f, 0, 'song'));
  v.setSelected(true); a.setSelected(true);

  // 1. Silences coupés sur une copie : 3 morceaux de voix.
  const cut = env.call('cutSilences', { ranges: [{ a: 2, b: 3 }, { a: 6, b: 7 }], copy: true });
  assert.ok(cut.ok, cut.error);
  const ns = env.ctx.app.project.activeSequence;
  assert.strictEqual(ns.videoTracks[0].items.length, 3);

  // 2. Zoom visage sur tous les plans de la copie (sans sélection), un sur deux.
  const r = env.call('resolve', { placement: 'full', scope: 'sequence', sides: ['post'], frames: 8, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.targets.length, 3);
  const picked = r.targets.slice().sort((p, q) => p.start - q.start).filter((t, i) => i % 2 === 1);
  const targets = picked.map(t => {
    const face = F.track([{ at: 0, eyes: { x: 0.35, y: 0.4 } }, { at: 1, eyes: { x: 0.45, y: 0.38 } }], t.frames);
    return Object.assign({}, t, { fx: Core.toWire(Core.compileEffect(Lib.byId['face-zoom'], { face, amount: 20 }, t.side, t.frames, r.fps)) });
  });
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX · Zoom visage', targets, refreshAdj: true });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.created.length, 1);
  const layer = ns.videoTracks.flatMap(t => t.items).find(it => /Zoom visage/.test(it.name));
  const tr = layer.components.find(c => c.matchName === 'AE.ADBE Geometry2');
  assert.ok(Math.abs(tr.properties[3].getValue() - 120) < 1e-6, 'scale 120 %');
  assert.ok(tr.properties[1].keys.length >= 2, 'position follows the eyes');

  // 3. Musique sous la voix : la sélection (la voix) n'est jamais prise pour la musique.
  ns.audioTracks[0].items.forEach(it => it.setSelected(true));
  const m = env.call('musicInfo', { notSelected: true });
  assert.ok(m.ok, m.error);
  assert.strictEqual(m.name, 'song');
  const speech = ns.audioTracks[0].items.map(it => ({ a: it._s / TICKS, b: it._e / TICKS }));
  const keys = V.duckKeys(speech, { from: m.start, to: m.end });
  const d = env.call('duckMusic', { track: m.track, start: m.start, keys });
  assert.ok(d.ok, d.error);
  const level = ns.audioTracks[1].items[0].components[0].properties[1];
  assert.strictEqual(level.keys.length, keys.length);
  assert.ok(env.call('undo', { entries: d.created }).removed === 1 && !level.isTimeVarying());
});
