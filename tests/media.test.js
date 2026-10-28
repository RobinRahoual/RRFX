/* Lecture du son des fichiers, comparée à ffmpeg sur de vrais WAV / MOV / MP4.
   Nécessite ffmpeg dans le PATH (sinon ces tests sont ignorés). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('../plugin/js/media.js');
const A = require('../plugin/js/audio.js');

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }
const opt = { skip: hasFfmpeg ? false : 'ffmpeg absent' };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-media-'));
const SR = 48000;

// Une musique stéréo de 20 s (canaux différents) écrite en WAV 16 bits.
function writeSongWav(file) {
  const n = SR * 20, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR, beat = t % 0.5;
    const kick = beat < 0.2 ? Math.exp(-beat * 20) * Math.sin(2 * Math.PI * 60 * beat) : 0;
    const l = 0.5 * kick + 0.2 * Math.sin(2 * Math.PI * (300 + 40 * Math.floor(t * 3)) * t);
    const r = 0.5 * kick + 0.2 * Math.sin(2 * Math.PI * 523 * t);
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

function ff(args) { execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(args)); }
// Référence : ffmpeg décode [t0, t0 + d] en mono flottant.
function ffDecode(file, t0, d, extra) {
  const out = execFileSync('ffmpeg', ['-v', 'error'].concat(extra || [], ['-i', file, '-ss', String(t0), '-t', String(d), '-af', 'pan=mono|c0=0.5*c0+0.5*c1', '-ar', String(SR), '-f', 'f32le', '-']), { maxBuffer: 1 << 28 });
  return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
}

const song = path.join(dir, 'song.wav');
if (hasFfmpeg) writeSongWav(song);
const io = f => M.nodeIO(fs, f);

function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test('WAV 16 / 24 bits / float : same samples as ffmpeg', opt, async () => {
  const files = { s16: song, s24: path.join(dir, 's24.wav'), f32: path.join(dir, 'f32.wav') };
  ff(['-i', song, '-c:a', 'pcm_s24le', files.s24]);
  ff(['-i', song, '-c:a', 'pcm_f32le', files.f32]);
  for (const k of Object.keys(files)) {
    const f = io(files[k]), info = await M.probe(f);
    assert.strictEqual(info.kind, 'wav');
    assert.strictEqual(info.sampleRate, SR);
    assert.ok(Math.abs(info.duration - 20) < 0.01);
    const w = await M.readWindow(f, info, 5, 8);
    assert.strictEqual(w.samples.length, 3 * SR);
    assert.ok(maxDiff(w.samples, ffDecode(files[k], 5, 3)) < 2e-4, k);
    f.close();
  }
});

// Comme une caméra : une piste vidéo puis une piste son.
function camera(file, codec, fmt) {
  ff(['-f', 'lavfi', '-i', 'color=black:s=64x36:r=25:d=20', '-i', song, '-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-c:a', codec].concat(fmt ? ['-f', fmt] : [], [file]));
}

for (const [name, codec, ext, fourcc] of [['twos (Sony XAVC S)', 'pcm_s16be', 'mov', 'twos'], ['sowt', 'pcm_s16le', 'mov', 'sowt'], ['in24', 'pcm_s24le', 'mov', 'in24'], ['fl32', 'pcm_f32be', 'mov', 'fl32']]) {
  test('MOV with ' + name + ' sound: decoded directly, same samples as ffmpeg', opt, async () => {
    const file = path.join(dir, fourcc + '.' + ext);
    camera(file, codec);
    const f = io(file), info = await M.probe(f);
    assert.strictEqual(info.codec, 'pcm');
    assert.strictEqual(info.format, fourcc);
    assert.ok(Math.abs(info.duration - 20) < 0.05, String(info.duration));
    const w = await M.readWindow(f, info, 7.3, 9.8);
    const ref = ffDecode(file, 7.3, 2.5);
    assert.ok(Math.abs(w.samples.length - ref.length) <= 2);
    assert.ok(maxDiff(w.samples, ref) < 2e-4, 'diff ' + maxDiff(w.samples, ref));
    f.close();
  });
}

test('MP4 with AAC sound: ADTS stream decodes to the same audio as the file', opt, async () => {
  const file = path.join(dir, 'aac.mp4');
  camera(file, 'aac');
  const f = io(file), info = await M.probe(f);
  assert.strictEqual(info.codec, 'aac');
  assert.strictEqual(info.sampleRate, SR);
  assert.strictEqual(info.channels, 2);
  const w = await M.readWindow(f, info, 6, 9);
  assert.ok(w.adts.length > 1000 && w.start <= 6 && w.start > 5.6);
  const adtsFile = path.join(dir, 'out.aac');
  fs.writeFileSync(adtsFile, w.adts);
  // Notre flux, décodé, puis recalé sur [6, 9] comme le fait le panneau.
  const mine = ffDecode(adtsFile, 0, 4);
  const from = Math.round((6 - w.start) * SR), ours = mine.subarray(from, from + 3 * SR);
  const ref = ffDecode(file, 6, 3);
  // Même son, au même instant (à 2 ms près : le décodeur AAC a un délai propre).
  let best = 0, bestLag = 0;
  for (let lag = -96; lag <= 96; lag++) {
    let s = 0, na = 0, nb = 0;
    for (let i = 2000; i < 2000 + SR; i++) { const a = ours[i], b = ref[i + lag] || 0; s += a * b; na += a * a; nb += b * b; }
    const c = s / Math.sqrt(na * nb);
    if (c > best) { best = c; bestLag = lag; }
  }
  assert.ok(best > 0.98, 'correlation ' + best);
  assert.ok(Math.abs(bestLag) <= 96, 'lag ' + bestLag);
  f.close();
});

test('sync on real files: a camera take recorded from the 4.2 s mark is found', opt, async () => {
  const take = path.join(dir, 'take.mov');
  ff(['-f', 'lavfi', '-i', 'color=black:s=64x36:r=25:d=10', '-ss', '4.2', '-i', song, '-t', '10', '-map', '0:v', '-map', '1:a',
    '-af', 'highpass=f=250,lowpass=f=5000,volume=0.3', '-c:v', 'mpeg4', '-c:a', 'pcm_s16be', take]);
  const mf = io(song), mi = await M.probe(mf), mw = await M.readWindow(mf, mi, 0, mi.duration);
  const tf = io(take), ti = await M.probe(tf), tw = await M.readWindow(tf, ti, 0, ti.duration);
  const r = A.findOffset(A.syncCurve(tw.samples, tw.sampleRate), A.syncCurve(mw.samples, mw.sampleRate));
  assert.ok(Math.abs(r.offset - 4.2) < 0.01, String(r.offset));
  mf.close(); tf.close();
});

test('unsupported or broken files give a clear error', opt, async () => {
  const txt = path.join(dir, 'x.txt');
  fs.writeFileSync(txt, 'hello world, not a media file');
  const info = await M.probe(io(txt));
  assert.strictEqual(info.kind, 'other');
  await assert.rejects(M.readWindow(io(txt), info, 0, 1));
  const silent = path.join(dir, 'video-only.mp4');
  ff(['-f', 'lavfi', '-i', 'color=black:s=64x36:r=25:d=1', '-c:v', 'mpeg4', silent]);
  await assert.rejects(M.probe(io(silent)), /piste son/);
});

test('ADTS header fields', () => {
  const h = M.adtsHeader({ objectType: 2, freqIndex: 3, channels: 2 }, 100);
  assert.strictEqual(h[0], 0xff);
  assert.strictEqual(h[1], 0xf1);
  assert.strictEqual((h[2] >> 6) + 1, 2, 'AAC LC');
  assert.strictEqual((h[2] >> 2) & 15, 3, '48 kHz');
  assert.strictEqual(((h[3] & 3) << 11) | (h[4] << 3) | (h[5] >> 5), 107, 'frame length');
});
