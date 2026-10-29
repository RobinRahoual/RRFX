/* Côté Premiere, 2.5 : musique à la durée, versions de séquence, dossiers surveillés, rangement
   du projet, renommage en série, temps passé, proxies. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv, TICKS } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item, audioItem, song } = env;
  // Vidéo 0-40 s (deux plans) ; musique 0-60 s sur A2 ; un bruitage sur A2 après la musique.
  seq.videoTracks[0].add(new Item(seq, media, 0, 500 * F, 0));
  seq.videoTracks[0].add(new Item(seq, media2, 500 * F, 1000 * F, 0));
  seq.audioTracks[1].add(audioItem(seq, song, 0, 1500 * F, 0, 'song.wav'));
  seq.audioTracks[1].add(audioItem(seq, media2, 1600 * F, 1650 * F, 0, 'woosh'));
  return env;
}
const music = env => env.seq.audioTracks[1].items.filter(i => i.projectItem === env.song).sort((a, b) => a._s - b._s);

test('fitMusic: plan, then a passage removed between two beats and the rest glued back', () => {
  const env = setup(), F = env.F;
  const p = env.call('fitMusic', { plan: true });
  assert.ok(p.ok, p.error);
  assert.strictEqual(p.videoEnd, 40);
  assert.deepStrictEqual([p.music.start, p.music.end, p.music.track], [0, 60, 1]);
  const r = env.call('fitMusic', { a: 20, b: 40 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.end, 40);
  const m = music(env);
  assert.strictEqual(m.length, 2, 'two pieces left');
  assert.deepStrictEqual(m.map(i => [i._s / F, i._e / F]), [[0, 500], [500, 1000]]);
  assert.strictEqual(m[1]._in, 1000 * F, 'the second piece plays from 40 s of the song');
  const sfx = env.seq.audioTracks[1].items.find(i => i.name === 'woosh');
  assert.strictEqual(sfx._s, 1600 * F, 'other sounds on the track do not move');
});

test('fitMusic: the end is trimmed when the cut cannot be exact', () => {
  const env = setup(), F = env.F;
  const r = env.call('fitMusic', { a: 0, b: 0, trim: 40 });
  assert.ok(r.ok, r.error);
  const m = music(env);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0]._e, 1000 * F);
});

test('versionSequence: frozen copy in the Versions bin, work goes on in the original', () => {
  const env = setup();
  const r = env.call('versionSequence', { name: 'Seq 01 v02', bin: 'Versions' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.name, 'Seq 01 v02');
  assert.strictEqual(env.call('getContext', {}).name, 'Seq 01', 'the original stays active');
  const versions = env.root.children.find(c => c.type === 2 && c.name === 'Versions');
  assert.ok(versions && versions.children.some(c => c.name === 'Seq 01 v02'));
  assert.strictEqual(env.call('listSequences', {}).sequences.length, 2);
});

test('importToBin: new files only, into nested bins', () => {
  const env = setup();
  const r = env.call('importToBin', { paths: ['/rushs/A001.mov', '/carte/C003.mp4', '/carte/C004.mp4'], bin: 'Rushs/Jour 1' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.imported, ['C003.mp4', 'C004.mp4']);
  assert.strictEqual(r.skipped, 1, 'A001.mov is already in the project');
  const rushs = env.root.children.find(c => c.name === 'Rushs'), day = rushs.children.find(c => c.name === 'Jour 1');
  assert.strictEqual(day.children.length, 2);
  // Deuxième passage : rien de nouveau.
  assert.deepStrictEqual(env.call('importToBin', { paths: ['/carte/C003.mp4'], bin: 'Rushs/Jour 1' }).imported, []);
});

test('tidyProject: loose items sorted by type, unused media parked, nothing deleted', () => {
  const env = setup();
  const loose = [['logo.png', '/x/logo.png'], ['voix.wav', '/x/voix.wav'], ['C010.mov', '/x/C010.mov']].map(([n, p]) => { const it = env.projItem(n, 1, 100); it.path = p; env.root.children.push(it); return it; });
  const dry = env.call('tidyProject', { dry: true, unused: true });
  assert.ok(dry.ok, dry.error);
  assert.deepStrictEqual(dry.counts, { image: 1, audio: 1, video: 1, sequence: 1 });
  assert.ok(dry.unused.includes('C010.mov') && !dry.unused.includes('A001.mov'), JSON.stringify(dry.unused));
  const r = env.call('tidyProject', { unused: true, names: { video: 'Vidéos', unused: 'Non utilisés' } });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.moved, 4);
  const names = env.root.children.map(c => c.name);
  ['Vidéos', 'Sons', 'Images', 'Séquences', 'Non utilisés'].forEach(b => assert.ok(names.includes(b), b + ' in ' + names));
  assert.ok(!env.root.children.includes(loose[0]), 'logo.png left the root');
  const unused = env.root.children.find(c => c.name === 'Non utilisés');
  assert.ok(unused.children.some(c => c.name === 'C010.mov'), 'unused clip parked');
  assert.ok(env.root.children.some(c => c.name === 'Calque de réglage'), 'adjustment layer stays');
});

test('renameItems: series names on the Project selection, undo puts the old names back', () => {
  const env = setup();
  env.setProjectSelection([env.media, env.media2]);
  const sel = env.call('renameItems', { dry: true });
  assert.deepStrictEqual(sel.items.map(i => i.name), ['A001.mov', 'B002.mov']);
  const r = env.call('renameItems', { ids: sel.items.map(i => i.id), names: ['Interview_001', 'Interview_002'] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([env.media.name, env.media2.name], ['Interview_001', 'Interview_002']);
  env.call('undo', { entries: r.renamed.map(x => ({ kind: 'rename', id: x.id, old: x.old })) });
  assert.deepStrictEqual([env.media.name, env.media2.name], ['A001.mov', 'B002.mov']);
});

test('activityPing: project and a signature that changes when something moves', () => {
  const env = setup();
  const a = env.call('activityPing', {});
  assert.strictEqual(a.project, 'Projet test.prproj');
  assert.strictEqual(a.path, '/projets/Projet test.prproj');
  env.seq.setPlayerPosition(String(100 * env.F));
  assert.notStrictEqual(env.call('activityPing', {}).sig, a.sig);
});

test('proxies: presets found, jobs queued in Media Encoder, attached when done', () => {
  const env = setup();
  const pr = env.call('proxyPresets', {});
  assert.deepStrictEqual(pr.presets.map(p => p.name), ['H.264 Low Resolution Proxy', 'ProRes Low Resolution Proxy']);
  env.setProjectSelection([env.media, env.media2, env.song]);
  const r = env.call('makeProxies', { preset: pr.presets[0].path, dir: '/rushs/Proxies' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.queued.length, 2, 'the song is not a video');
  assert.ok(env.encoder.started && env.folders.has('/rushs/Proxies'));
  assert.strictEqual(env.call('proxyStatus', {}).finished, 0);
  env.encoder.finish();
  const st = env.call('proxyStatus', {});
  assert.deepStrictEqual([st.total, st.finished, st.attached], [2, 2, 2]);
  assert.strictEqual(env.media.proxy, '/rushs/Proxies/A001_Proxy.mp4');
  // Déjà un proxy : passé.
  assert.strictEqual(env.call('makeProxies', { preset: pr.presets[0].path, dir: '/rushs/Proxies' }).skipped, 2);
  assert.match(env.call('makeProxies', { dir: '/x' }).error, /préréglage/);
});
