/* Outils gratuits : catalogue, choix des paquets par système, lignes de commande, sorties lues. */
const { test } = require('node:test');
const assert = require('node:assert');
const Lb = require('../plugin/js/libres.js');

test('libres: every tool has an install path on Windows and on both Macs', () => {
  for (const t of Lb.TOOLS) {
    for (const p of ['win', 'mac-arm64', 'mac-x64']) {
      const how = Lb.howFor(t, p);
      assert.ok(how, t.id + ' on ' + p);
      assert.ok(['file', 'archive', 'wheel', 'pip', 'brew'].indexOf(how.type) >= 0, t.id);
      if (how.url) assert.match(how.url, /^https:\/\//);
    }
    assert.ok(t.exe.length && t.what && t.uses.length && t.license && t.site, t.id);
  }
  assert.strictEqual(Lb.howFor(Lb.byId('deepfilter'), 'mac-arm64').url.indexOf('aarch64-apple-darwin') > 0, true);
  assert.strictEqual(Lb.howFor(Lb.byId('deepfilter'), 'mac-x64').url.indexOf('x86_64-apple-darwin') > 0, true);
  assert.strictEqual(Lb.howFor(Lb.byId('whisper'), 'mac-arm64').type, 'brew');
  assert.strictEqual(Lb.plat('win32', 'x64'), 'win');
  assert.strictEqual(Lb.plat('darwin', 'arm64'), 'mac-arm64');
  assert.strictEqual(Lb.plat('darwin', 'x64'), 'mac-x64');
});

test('libres: the right PyPI wheel for each system', () => {
  const files = [
    'imageio_ffmpeg-0.7.0.tar.gz',
    'imageio_ffmpeg-0.7.0-py3-none-macosx_10_9_intel.macosx_10_9_x86_64.whl',
    'imageio_ffmpeg-0.7.0-py3-none-macosx_11_0_arm64.whl',
    'imageio_ffmpeg-0.7.0-py3-none-manylinux2014_aarch64.whl',
    'imageio_ffmpeg-0.7.0-py3-none-manylinux2014_x86_64.whl',
    'imageio_ffmpeg-0.7.0-py3-none-win32.whl',
    'imageio_ffmpeg-0.7.0-py3-none-win_amd64.whl'
  ].map(filename => ({ filename, url: 'https://files/' + filename }));
  assert.match(Lb.pickWheel(files, 'win').filename, /win_amd64/);
  assert.match(Lb.pickWheel(files, 'mac-arm64').filename, /arm64/);
  assert.match(Lb.pickWheel(files, 'mac-x64').filename, /x86_64/);
  assert.match(Lb.pickWheel(files, 'linux').filename, /manylinux2014_x86_64/);
  assert.strictEqual(Lb.pickWheel([{ filename: 'a-1.0.tar.gz' }], 'win'), null);
  // Paquet universel : pris sur tous les systèmes.
  assert.ok(Lb.pickWheel([{ filename: 'x-1-py3-none-any.whl' }], 'mac-arm64'));
  // Seul un paquet Intel : pris aussi sur Apple Silicon (Rosetta).
  assert.ok(Lb.pickWheel([{ filename: 'x-1-py3-none-macosx_10_9_x86_64.whl' }], 'mac-arm64'));
  const member = new RegExp(Lb.howFor(Lb.byId('diarize'), 'win').member);
  assert.ok(member.test('sherpa_onnx_bin-2.0.1.data/data/Scripts/sherpa-onnx-offline-speaker-diarization.exe'));
  assert.ok(member.test('sherpa_onnx_bin-2.0.1.data/data/bin/sherpa-onnx-offline-speaker-diarization'));
  assert.ok(!member.test('sherpa_onnx_bin-2.0.1.data/data/bin/sherpa-onnx-offline-tts'));
  assert.ok(new RegExp(Lb.byId('ffmpeg').how.any.member).test('imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'));
  assert.ok(!new RegExp(Lb.byId('ffmpeg').how.any.member).test('imageio_ffmpeg/binaries/__init__.py'));
});

test('libres: python versions, venv paths and pip progress', () => {
  assert.deepStrictEqual(Lb.pyVersion('Python 3.12.4'), [3, 12, 4]);
  assert.strictEqual(Lb.pyVersion('Python est introuvable'), null);
  assert.ok(Lb.atLeast([3, 12, 0], [3, 10]));
  assert.ok(!Lb.atLeast([3, 9, 6], [3, 10]));
  assert.ok(!Lb.atLeast(null, [3, 10]));
  assert.strictEqual(Lb.venv('C:\\RRFX\\python', true).python, 'C:\\RRFX\\python\\Scripts\\python.exe');
  assert.strictEqual(Lb.venv('/u/RRFX/python', false).exe('demucs'), '/u/RRFX/python/bin/demucs');
  assert.deepStrictEqual(Lb.pipStep('Collecting torch>=2.1'), { what: 'torch' });
  assert.deepStrictEqual(Lb.pipStep('Downloading torch-2.5.1-cp312-none-macosx_11_0_arm64.whl (63.9 MB)'), { what: 'torch', size: '63.9 MB' });
  assert.ok(Lb.pipStep('Installing collected packages: numpy, torch').last);
  assert.strictEqual(Lb.pipStep('   ━━━━━━━━ 12.3/63.9 MB'), null);
  const win = Lb.pythonCandidates('win32', { LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U' });
  assert.ok(win.some(c => c.cmd === 'py' && c.args[0] === '-3'));
  assert.ok(win[0].cmd.indexOf('RRFX\\Outils\\python312') > 0);
  assert.ok(Lb.pythonCandidates('darwin', {}).every(c => c.cmd !== '/usr/bin/python3'), 'the macOS stub opens an install popup');
});

test('libres: executables found by name, on each system', () => {
  const files = ['/t/rife/rife-ncnn-vulkan-20221029-macos/rife-ncnn-vulkan', '/t/rife/rife-ncnn-vulkan-20221029-macos/rife-v4.6/flownet.param'];
  assert.strictEqual(Lb.findExe(files, ['rife-ncnn-vulkan'], false), files[0]);
  assert.strictEqual(Lb.findExe(['C:\\t\\whisper\\Release\\whisper-cli.exe'], ['whisper-cli'], true), 'C:\\t\\whisper\\Release\\whisper-cli.exe');
  assert.strictEqual(Lb.findExe(['/t/x/readme.txt'], ['ffmpeg'], false), '');
  assert.strictEqual(Lb.exeName('ffmpeg', true), 'ffmpeg.exe');
  assert.strictEqual(Lb.exeName('ffmpeg.exe', true), 'ffmpeg.exe');
});

test('libres: ffmpeg command lines and output', () => {
  const a = Lb.ffAudio('in.mov', 'out.wav', { start: 12.5, dur: 3 });
  assert.deepStrictEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4), ['-ss', '12.500', '-t', '3.000']);
  assert.ok(a.indexOf('-ar') > 0 && a[a.indexOf('-ar') + 1] === '16000' && a[a.length - 1] === 'out.wav');
  assert.ok(Lb.ffAudio('in.mov', 'o.wav', { channels: 2, rate: 48000 }).join(' ').indexOf('-ac 2 -ar 48000') > 0);
  const f = Lb.ffFrames('in.mp4', '/w', { start: 1, dur: 2, height: 1080 });
  assert.strictEqual(f[f.length - 1], '/w/%06d.png');
  assert.ok(f.join(' ').indexOf("scale=-2:'min(1080,ih)'") > 0);
  const e = Lb.ffEncode('/w', 'out.mov', { fps: 50, alpha: true });
  assert.ok(e.indexOf('prores_ks') > 0 && e.indexOf('yuva444p10le') > 0 && e[e.indexOf('-framerate') + 1] === '50');
  assert.ok(Lb.ffEncode('/w', 'o.mp4', { audio: 'a.wav' }).indexOf('libx264') > 0);
  const p = Lb.ffProbe('Input #0, mov\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s\n    Stream #0:0: Video: h264, 1920x1080, 29.97 fps, 29.97 tbr');
  assert.strictEqual(p.dur, 62.5);
  assert.strictEqual(p.fps, 29.97);
  assert.strictEqual(Lb.ffProgress('frame= 10 fps=0 size= 1kB time=00:00:31.25 bitrate=', 62.5), 0.5);
  assert.strictEqual(Lb.ffProgress('nothing', 10), null);
});

test('libres: diarization, beats and other tool outputs', () => {
  const d = Lb.parseDiarization('Started\n0.318 -- 6.865 speaker_00\n7.017 -- 10.747 speaker_01 confidence=0.912\n6.9 -- 7.0 speaker_00\nDuration : 10.7 s\n');
  assert.deepStrictEqual(d.map(x => x.speaker), [0, 0, 1]);
  assert.strictEqual(d[2].a, 7.017);
  const args = Lb.diarizeArgs({ segmentation: 's.onnx', embedding: 'e.onnx', num: 2, wav: 'a.wav' });
  assert.ok(args.indexOf('--clustering.num-clusters=2') >= 0 && args[args.length - 1] === 'a.wav');
  assert.ok(Lb.diarizeArgs({ segmentation: 's', embedding: 'e', wav: 'w' }).some(x => /cluster-threshold=0.9/.test(x)));
  const b = Lb.parseBeats('0.48\t1\n0.98\t2\n1.47\t3\n1.96\t4\n2.45\t1\n');
  assert.deepStrictEqual(b.beats, [0.48, 0.98, 1.47, 1.96, 2.45]);
  assert.deepStrictEqual(b.downbeats, [0.48, 2.45]);
  assert.deepStrictEqual(Lb.demucsArgs({ out: '/o', input: 'in.wav', two: 'vocals' }), ['-n', 'htdemucs', '-o', '/o', '--filename', '{stem}.{ext}', '--two-stems', 'vocals', 'in.wav']);
  assert.strictEqual(Lb.percentOf(' 45%|████▌     | 12.0/26.3 [00:10<00:12]'), 0.45);
  assert.strictEqual(Lb.ncnnProgress('12.50%'), 0.125);
  assert.deepStrictEqual(Lb.deepFilterArgs({ out: '/o', input: 'v.wav', atten: 30 }), ['-o', '/o', '--atten-lim-db', '30', 'v.wav']);
  assert.ok(Lb.rifeArgs({ input: 'i', output: 'o', count: 96, model: '/r/rife-v4.6' }).join(' ').indexOf('-n 96 -m /r/rife-v4.6') > 0);
  assert.ok(Lb.esrganArgs({ input: 'i', output: 'o', models: '/m' }).join(' ').indexOf('-n realesrgan-x4plus -s 4 -m /m') > 0);
  assert.deepStrictEqual(Lb.rembgArgs({ input: 'i', output: 'o' }), ['p', '-m', 'u2net_human_seg', 'i', 'o']);
  assert.ok(Lb.piperArgs({ model: 'v.onnx', out: 'o.wav', text: 't.txt' }).indexOf('-i') >= 0);
  assert.strictEqual(Lb.size(412), '412 Mo');
  assert.strictEqual(Lb.size(1500), '1,5 Go');
});
