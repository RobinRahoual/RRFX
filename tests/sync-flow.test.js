/* Synchro multicaméra de bout en bout : le vrai code de l'onglet Musique, de vrais fichiers
   WAV, et le script Premiere sur la timeline simulée. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { makeEnv } = require('./sim');
const Core = require('../plugin/js/core.js');
const Audio = require('../plugin/js/audio.js');
const Media = require('../plugin/js/media.js');

const SR = 22050;
// Un concert : des notes et des coups à des instants irréguliers (rien ne se répète).
function performance(seconds) {
  const x = new Float32Array(seconds * SR);
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0.1; t < seconds; t += 0.12 + rnd() * 0.5) {
    const f = rnd() < 0.3 ? 55 + rnd() * 40 : 200 + rnd() * 1800, a = Math.round(t * SR), amp = 0.2 + rnd() * 0.5, dec = 8 + rnd() * 30;
    for (let i = 0; i < SR * 0.4 && a + i < x.length; i++) x[a + i] += amp * Math.exp(-i / SR * dec) * Math.sin(2 * Math.PI * f * i / SR);
  }
  return x;
}
// Ce qu'entend une caméra lancée à `from` : son filtré, plus faible, bruité.
function camera(src, from, seconds, cutoff, noiseSeed) {
  const n = seconds * SR, out = new Float32Array(n), a = Math.round(from * SR);
  let seed = noiseSeed;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (a + i < src.length ? 0.5 * src[a + i] : 0) + 0.02 * (seed / 0x7fffffff * 2 - 1);
  }
  return Audio.lowpass(out, SR, cutoff);
}
function writeWav(file, x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32000))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-sync-'));
const show = performance(70);
const cam1 = path.join(dir, 'CAM1.wav'), cam2 = path.join(dir, 'CAM2.wav');
writeWav(cam1, camera(show, 0, 70, 6000, 5));
writeWav(cam2, camera(show, 17.3, 30, 3000, 9)); // lancée 17,3 s après la caméra 1

// Le panneau minimal autour de music.js, branché sur la timeline simulée.
function loadPanel(env) {
  const root = { RRFXFeatures: [] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'js', 'music.js'), 'utf8'), { self: root, console });
  const settings = {}, logs = [], history = [];
  const app = {
    S: { cancel: false }, Core, Audio, Media, Store: { fs, path },
    Host: { call: async (fn, arg) => env.call(fn, arg) },
    UI: {}, settings: () => settings, persist() {}, log: (m, l) => logs.push([l, m]),
    status: { phase() {}, progress() {}, finish() {} }, runTask: (label, task) => task(),
    plural: (n, one, many) => n + ' ' + (n > 1 ? many || one + 's' : one), errorMessage: e => e.message || String(e),
    pushHistory: op => history.push(op), switchTab() {}, fps: () => 25, tabs: {}, actions: {}, services: {}
  };
  root.RRFXFeatures.forEach(f => f(app));
  return { app, settings, logs, history };
}

test('multicam sync on the timeline: the second camera moves 12.3 s, the reference stays', async () => {
  const env = makeEnv(25), { seq, F, Item } = env;
  const p1 = env.projItem('CAM1.wav', 1, 70 * 25 * F), p2 = env.projItem('CAM2.wav', 1, 30 * 25 * F);
  p1.path = cam1; p2.path = cam2;
  const c1 = seq.videoTracks[0].add(new Item(seq, p1, 0, 1000 * F, 0));
  const c2 = seq.videoTracks[1].add(new Item(seq, p2, 125 * F, 625 * F, 0)); // posée à 5 s, à l'œil
  c1.selected = c2.selected = true;
  const P = loadPanel(env);
  P.settings.sync = { ref: 'camera', camRef: 'longest' };
  const r = await P.app.actions.sync();
  assert.strictEqual(r.kind, 'ok', JSON.stringify(r) + JSON.stringify(P.logs));
  assert.strictEqual(c1._s, 0, 'reference untouched');
  assert.ok(Math.abs(c2._s / F - 17.3 * 25) <= 1, 'camera 2 at ' + c2._s / F / 25 + ' s');
});

test('multicam sync from the Project panel: reference with its sound at the playhead, camera 2 above', async () => {
  const env = makeEnv(25), { seq, F } = env;
  const p1 = env.projItem('CAM1.wav', 1, 70 * 25 * F), p2 = env.projItem('CAM2.wav', 1, 30 * 25 * F);
  p1.path = cam1; p2.path = cam2;
  env.bin.children.push(p1, p2);
  env.setProjectSelection([p2, p1]);
  seq._ph = 50 * F; // tête de lecture à 2 s
  const P = loadPanel(env);
  P.settings.sync = { ref: 'camera', camRef: 'longest' };
  const r = await P.app.actions.sync();
  assert.strictEqual(r.kind, 'ok', JSON.stringify(r) + JSON.stringify(P.logs));
  const vids = seq.videoTracks.flatMap(t => t.items.map(i => ({ track: t.i, name: i.projectItem.name, s: i._s / F / 25 })));
  const ref = vids.find(v => /CAM1/.test(v.name)), other = vids.find(v => /CAM2/.test(v.name));
  assert.ok(ref && other, JSON.stringify(vids));
  assert.ok(Math.abs(ref.s - 2) < 0.05 && Math.abs(other.s - 19.3) <= 0.05, JSON.stringify(vids));
  assert.notStrictEqual(ref.track, other.track);
  const sound = seq.audioTracks.flatMap(t => t.items).find(i => /CAM1/.test(i.projectItem.name));
  assert.ok(sound && sound.projectItem.audioOnly && Math.abs(sound._s / F / 25 - 2) < 0.05, 'reference sound placed');
  assert.strictEqual(P.history.length, 2);
});

test('an unrelated camera is left alone', async () => {
  const env = makeEnv(25), { seq, F, Item } = env;
  const other = path.join(dir, 'OTHER.wav');
  writeWav(other, camera(performance(40).reverse(), 3, 25, 3000, 2));
  const p1 = env.projItem('CAM1.wav', 1, 70 * 25 * F), p3 = env.projItem('OTHER.wav', 1, 25 * 25 * F);
  p1.path = cam1; p3.path = other;
  const c1 = seq.videoTracks[0].add(new Item(seq, p1, 0, 1000 * F, 0));
  const c3 = seq.videoTracks[1].add(new Item(seq, p3, 125 * F, 500 * F, 0));
  c1.selected = c3.selected = true;
  const P = loadPanel(env);
  P.settings.sync = { ref: 'camera', camRef: 'lowest' };
  const r = await P.app.actions.sync();
  assert.strictEqual(r.kind, 'error');
  assert.strictEqual(c3._s, 125 * F);
  assert.ok(P.logs.some(([l, m]) => l === 'warn' && /laissé tel quel/.test(m)));
});

test('music sync: only the used part of the song is read, the camera lands on it', async () => {
  const env = makeEnv(25), { seq, F, Item } = env;
  const song = path.join(dir, 'SONG.wav'), take = path.join(dir, 'TAKE.wav');
  writeWav(song, show);
  writeWav(take, camera(show, 20, 15, 3000, 4)); // prise lancée à 20 s du morceau
  const ps = env.projItem('SONG.wav', 1, 70 * 25 * F), pt = env.projItem('TAKE.wav', 1, 15 * 25 * F);
  ps.path = song; pt.path = take;
  const music = new Item(seq, ps, 125 * F, 1125 * F, 250 * F); // morceau de 10 s à 50 s, posé à 5 s
  music.mediaType = 'Audio';
  seq.audioTracks[1].add(music);
  const clip = seq.videoTracks[0].add(new Item(seq, pt, 50 * F, 300 * F, 0));
  clip.selected = true;
  const P = loadPanel(env);
  P.settings.sync = { ref: 'music', camRef: 'longest' };
  const r = await P.app.actions.sync();
  assert.strictEqual(r.kind, 'ok', JSON.stringify(r) + JSON.stringify(P.logs));
  // 20 s du morceau = 5 + (20 - 10) = 15 s de séquence.
  assert.ok(Math.abs(clip._s / F / 25 - 15) <= 0.04, 'clip at ' + clip._s / F / 25);
  assert.ok(P.logs.some(([, m]) => /s lues/.test(m) && /4[0-9] s lues/.test(m)), 'about 44 s read, not the 70 s file: ' + JSON.stringify(P.logs));
});

test('beat markers land on the kicks of the used part of the song', async () => {
  const env = makeEnv(25), { seq, F, Item } = env;
  const kicks = new Float32Array(40 * SR);
  for (let t = 0; t < 40; t += 0.5) {
    const a = Math.round(t * SR);
    for (let i = 0; i < SR * 0.25 && a + i < kicks.length; i++) kicks[a + i] += 0.8 * Math.exp(-i / SR * 25) * Math.sin(2 * Math.PI * 60 * i / SR);
  }
  const file = path.join(dir, 'KICKS.wav');
  writeWav(file, kicks);
  const pk = env.projItem('KICKS.wav', 1, 40 * 25 * F);
  pk.path = file;
  const music = new Item(seq, pk, 100 * F, 350 * F, 255 * F); // de 10,2 s à 20,2 s du fichier, posé à 4 s
  music.mediaType = 'Audio';
  seq.audioTracks[0].add(music);
  const P = loadPanel(env);
  P.settings.beats = { mode: 'kicks', sensitivity: 50, minGap: 120, every: 1, zone: 'music', replace: true };
  const r = await P.app.actions.beats();
  assert.strictEqual(r.kind, 'ok', JSON.stringify(r) + JSON.stringify(P.logs));
  const times = env.call('markerList', {}).markers.map(m => m.t);
  // Kicks du fichier à 10,5 ; 11 ; … → séquence 4 + (t - 10,2) = 4,3 ; 4,8 ; …
  assert.ok(times.length >= 18 && times.length <= 21, times.length + ' markers');
  times.forEach(t => {
    const fileT = t - 4 + 10.2, err = Math.abs(fileT - Math.round(fileT * 2) / 2);
    assert.ok(err <= 0.045, 'marker at ' + t.toFixed(3) + ' is ' + err.toFixed(3) + ' s off a kick');
  });
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
