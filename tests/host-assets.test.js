/* Ressources côté Premiere : poser et importer des fichiers du disque (timeline simulée). */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, song, Item } = env;
  env.A = seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  env.B = seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 200 * F, 20 * F));
  const music = new Item(seq, song, 0, 600 * F, 0);
  music.mediaType = 'Audio';
  seq.audioTracks[1].add(music);
  const cam = new Item(seq, media, 0, 100 * F, 50 * F);
  cam.mediaType = 'Audio';
  seq.audioTracks[0].add(cam);
  return env;
}

test('SFX on every marker: free audio track, music untouched, undo removes them', () => {
  const env = setup();
  const r = env.call('placeAsset', { path: '/Pack/SFX/whoosh.wav', kind: 'audio', name: 'whoosh', times: [1, 3, 5] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.created.length, 3);
  // Le son dure 2,4 s : le 2e chevauche le 1er (piste suivante), le 3e revient sur la première.
  assert.deepStrictEqual(r.created.map(c => c.kind + c.track), ['aud2', 'aud3', 'aud2'], JSON.stringify(r.created));
  assert.deepStrictEqual(env.seq.audioTracks[2].items.map(i => i._s / env.F).sort((a, b) => a - b), [25, 125]);
  assert.strictEqual(env.seq.audioTracks[1].items.length, 1, 'music untouched');
  assert.strictEqual(env.imports.length, 1, 'imported once');
  const bin = env.root.children.find(c => c.name === 'RR FX Ressources');
  assert.ok(bin && bin.children.length === 1);
  assert.strictEqual(env.call('undo', { entries: r.created }).removed, 3);
  assert.strictEqual(env.seq.audioTracks[2].items.length + env.seq.audioTracks[3].items.length, 0);
});

test('video goes above everything, without its sound; images get their duration', () => {
  const env = setup();
  const v = env.call('placeAsset', { path: '/Pack/Leak.mov', kind: 'video', name: 'Leak', times: [2] });
  assert.ok(v.ok, v.error);
  const it = env.seq.videoTracks[v.created[0].track].items[0];
  assert.strictEqual(v.created[0].track, 1, 'above V1');
  assert.ok(it.projectItem.videoOnly, 'video only');
  assert.strictEqual(it.name, 'Leak.mov', 'keeps its own name (not removed by « Tout effacer »)');
  const img = env.call('placeAsset', { path: '/Pack/logo.png', kind: 'image', name: 'logo', times: [2], imageDur: 3 });
  assert.ok(img.ok, img.error);
  const im = env.seq.videoTracks[img.created[0].track].items[0];
  assert.strictEqual(img.created[0].track, 2, 'above the video just placed');
  assert.strictEqual((im._e - im._s) / env.F, 75);
  const c = env.call('clearAll', { scope: 'sequence' });
  assert.strictEqual(c.removed, 0, 'user resources are not RR FX layers');
});

test('a .mogrt title is placed as is; import only; errors are clear', () => {
  const env = setup();
  const t = env.call('placeAsset', { path: '/Pack/Titres/Lower.mogrt', kind: 'mogrt', name: 'Lower', times: [0] });
  assert.ok(t.ok, t.error);
  assert.strictEqual(t.created[0].track, 1);
  const i = env.call('importAssets', { paths: ['/Pack/a.wav', '/Pack/b.png', '/Pack/a.wav'] });
  assert.ok(i.ok);
  assert.strictEqual(i.imported, 3);
  assert.strictEqual(env.imports.length, 2, 'a.wav imported once');
  assert.match(env.call('placeAsset', { path: '/x.wav', kind: 'audio', times: [] }).error, /Aucun endroit/);
});
