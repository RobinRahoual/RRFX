/* Côté Premiere, 2.4 : volume par images clés, séquences (lot, historique), extraits, vérification
   avant export, images fixes, modèles de projet. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv, TICKS } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item, audioItem } = env;
  // 0-10 s : interview (V1 + son A1) ; 12-20 s : un 2e plan (trou de 2 s entre les deux) ; musique A2.
  const v = seq.videoTracks[0].add(new Item(seq, media, 0, 250 * F, 0));
  const a = seq.audioTracks[0].add(audioItem(seq, media, 0, 250 * F, 0));
  seq.videoTracks[0].add(new Item(seq, media2, 300 * F, 500 * F, 0));
  seq.audioTracks[1].add(audioItem(seq, media2, 0, 500 * F, 0, 'song'));
  v.setSelected(true); a.setSelected(true);
  return env;
}
const sec = (env, x) => Math.round(x / env.F) / 25;

test('gainKeys: volume keys relative to the current level, only inside the clip, undo puts it back', () => {
  const env = setup(), voice = env.seq.audioTracks[0].items[0], p = voice.components[0].properties[1];
  const before = p.getValue();
  const r = env.call('gainKeys', { track: 0, start: 0, keys: [[1.97, 0], [2, -12], [2.4, -12], [2.43, 0], [30, -12]], label: 'Interview' });
  assert.ok(r.ok, r.error);
  assert.ok(p.isTimeVarying());
  assert.strictEqual(p.keys.length, 4, 'the key outside the clip is skipped');
  const db = v => 20 * Math.log10(v) + 15;
  assert.ok(Math.abs(db(p.keys[1].v) - (db(before) - 12)) < 1e-6);
  env.call('undo', { entries: r.created });
  assert.ok(!p.isTimeVarying() && p.getValue() === before);
  assert.match(env.call('gainKeys', { track: 0, start: 99, keys: [] }).error, /introuvable/);
});

test('sequences: listed, opened; an operation from another sequence is undone in its own sequence', () => {
  const env = setup();
  const res = env.call('resolve', { placement: 'sequence', sides: ['post'], frames: 1, target: 'adjustment' });
  const r = env.call('apply', { target: 'adjustment', name: 'RR FX · Look', targets: res.targets.map(t => Object.assign({}, t, { name: 'RR FX · Look', fx: [] })) });
  assert.ok(r.ok, r.error);
  const first = env.call('getContext', {}).seqId;
  env.seq.clone();
  const list = env.call('listSequences', {});
  assert.strictEqual(list.sequences.length, 2);
  const other = list.sequences.find(q => q.id !== first);
  assert.ok(env.call('openSequence', { id: other.id }).ok);
  assert.strictEqual(env.call('getContext', {}).seqId, other.id);
  const u = env.call('undo', { entries: r.created, seq: first });
  assert.ok(u.ok, u.error);
  assert.strictEqual(u.removed, 1);
  assert.strictEqual(env.call('getContext', {}).seqId, first, 'its sequence was reopened');
  assert.match(env.call('openSequence', { id: 'nope' }).error, /introuvable/);
});

test('extractCopy: [4 s, 14 s] in a new sequence, every track cut and moved to the start, original intact', () => {
  const env = setup();
  const r = env.call('extractCopy', { a: 4, b: 14, name: 'Podcast · Extrait 1' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.name, 'Podcast · Extrait 1');
  assert.strictEqual(r.seconds, 10);
  const s = env.ctx.app.project.activeSequence;
  assert.notStrictEqual(s, env.seq);
  const spans = tr => tr.items.slice().sort((p, q) => p._s - q._s).map(it => [sec(env, it._s), sec(env, it._e)]);
  assert.deepStrictEqual(spans(s.videoTracks[0]), [[0, 6], [8, 10]]);
  assert.deepStrictEqual(spans(s.audioTracks[0]), [[0, 6]]);
  assert.deepStrictEqual(spans(s.audioTracks[1]), [[0, 10]]);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 2, 'original untouched');
});

test('preflight: black gap, offline media, muted track, loud clip; a clean sequence passes', () => {
  const env = setup();
  const r = env.call('preflight', {});
  assert.ok(r.ok, r.error);
  const gap = r.issues.find(i => /Image noire/.test(i.text));
  assert.ok(gap && gap.level === 'error' && gap.t === 10, JSON.stringify(r.issues));
  const clip = env.seq.videoTracks[0].items[0];
  clip.projectItem.isOffline = () => true;
  env.seq.audioTracks[1].isMuted = () => true;
  const loud = env.seq.audioTracks[1].items[0].components[0].properties[1];
  loud.setValue(Math.pow(10, (9 - 15) / 20));
  const r2 = env.call('preflight', {});
  assert.ok(r2.issues.some(i => i.level === 'error' && /hors ligne/.test(i.text)));
  assert.ok(r2.issues.some(i => /A2/.test(i.where) && /coupée/.test(i.text)));
  assert.ok(r2.issues.some(i => /\+9 dB/.test(i.text)));
  assert.deepStrictEqual(r2.issues.map(i => i.t), r2.issues.map(i => i.t).slice().sort((p, q) => p - q), 'sorted by time');
  const clean = makeEnv(25);
  clean.seq.videoTracks[0].add(new clean.Item(clean.seq, clean.media, 0, 100 * clean.F, 0));
  assert.deepStrictEqual(clean.call('preflight', {}).issues, []);
});

test('placeStills: numbers one after another on one free track; undo removes them', () => {
  const env = setup();
  const r = env.call('placeStills', { items: [3, 2, 1].map((n, i) => ({ path: '/img/' + n + '.png', t: 2 + i, dur: 1 })), name: 'RR FX · Compte à rebours', minTrack: 1 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.created.length, 3);
  const tr = env.seq.videoTracks[r.track];
  assert.ok(r.track >= 1);
  assert.deepStrictEqual(tr.items.slice().sort((p, q) => p._s - q._s).map(it => [sec(env, it._s), sec(env, it._e)]), [[2, 3], [3, 4], [4, 5]]);
  env.call('undo', { entries: r.created });
  assert.strictEqual(tr.items.length, 0);
});

test('newFromTemplate: an empty copy at the template size with an adjustment layer, original intact', () => {
  const env = setup();
  const r = env.call('newFromTemplate', { name: 'Reels · test', width: 1080, height: 1920, adj: true });
  assert.ok(r.ok, r.error);
  const s = env.ctx.app.project.activeSequence;
  assert.strictEqual(s.name, 'Reels · test');
  assert.deepStrictEqual([Number(s.frameSizeHorizontal), Number(s.frameSizeVertical)], [1080, 1920]);
  assert.strictEqual(r.clips, 0);
  assert.ok(r.adjPlaced);
  assert.strictEqual(env.seq.videoTracks[0].items.length, 2, 'original untouched');
});
