/* Scripts Python embarqués (SAM 2, profondeur, CLAP) et nouvelles commandes des outils (2.10). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Py = require('../plugin/js/pyscripts.js');
const Lb = require('../plugin/js/libres.js');

const python = ['python3', 'python'].find(c => { try { return cp.spawnSync(c, ['--version']).status === 0; } catch (e) { return false; } });

test('pyscripts: every script compiles with Python', { skip: !python && 'Python absent' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-py-'));
  for (const [name, src] of Object.entries(Py.SCRIPTS)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, src, 'utf8');
    const r = cp.spawnSync(python, ['-m', 'py_compile', f], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, name + ' : ' + r.stderr);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pyscripts: the scripts call the libraries the way they expect', () => {
  const sam = Py.SCRIPTS['rrfx_sam.py'];
  assert.match(sam, /Sam2VideoProcessor\.from_pretrained/);
  assert.match(sam, /init_video_session\(inference_device=dev, dtype=dtype\)/);
  assert.match(sam, /input_boxes=\[\[box\]\]/);
  assert.match(sam, /model\(inference_session=session, frame=/);
  assert.match(sam, /post_process_masks\(\[res\.pred_masks\]/);
  assert.match(Py.SCRIPTS['rrfx_depth.py'], /post_process_depth_estimation\(pred, target_sizes=\[\(h, w\)\]\)/);
  assert.match(Py.SCRIPTS['rrfx_clap.py'], /CLAP\(version="2023"/);
  assert.match(Py.SCRIPTS['rrfx_clap.py'], /_get_audio_embeddings\(t\)/);
  assert.strictEqual(Py.progress('PROGRESS 3 12'), 0.25);
  assert.strictEqual(Py.progress('Loading model'), null);
  assert.deepStrictEqual(Py.jsonLines('{"a":1}\nbroken\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
});

test('libres: script tools, separate environment for CLAP, mask and denoise commands', () => {
  ['vision', 'voicefixer', 'clap'].forEach(id => {
    const t = Lb.byId(id);
    assert.ok(t.script && Lb.howFor(t, 'win').type === 'pip', id);
  });
  assert.strictEqual(Lb.byId('clap').venv, 'clap', 'msclap needs numpy < 2: own environment');
  assert.strictEqual(Lb.byId('vision').venv, undefined);
  assert.match(Lb.byId('vision').hf.depth, /Depth-Anything-V2-Small/);
  const iso = Lb.ffMask('/f', '/m', 'o.mov', { mode: 'isolate' }).join(' ');
  assert.ok(/alphamerge/.test(iso) && /prores_ks/.test(iso));
  const focus = Lb.ffMask('/f', '/m', 'o.mp4', { mode: 'focus', blur: 30 }).join(' ');
  assert.ok(/negate/.test(focus) && /boxblur=30:2/.test(focus) && /libx264/.test(focus));
  assert.ok(!/negate/.test(Lb.ffMask('/f', '/m', 'o.mp4', { mode: 'blur' }).join(' ')));
  const dn = Lb.ffDenoise('in.mov', 'out.mp4', { start: 2, dur: 5, level: 'strong' });
  assert.ok(dn.indexOf('-an') > 0 && dn[dn.indexOf('-vf') + 1] === Lb.DENOISE.strong);
  assert.deepStrictEqual(Lb.voicefixerArgs({ input: 'a.wav', out: 'b.wav' }).slice(0, 2), ['-m', 'voicefixer']);
  assert.ok(Lb.voicefixerArgs({ input: 'a', out: 'b', mode: '2' }).join(' ').indexOf('--mode 2') > 0);
  assert.ok(Lb.CUT_MODELS.some(m => m.id === 'birefnet-portrait'));
  assert.deepStrictEqual(Lb.rembgArgs({ input: 'i', output: 'o', model: 'birefnet-general' }), ['p', '-m', 'birefnet-general', 'i', 'o']);
});
