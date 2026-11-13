/* Import par lien : noms de fichiers sûrs, jamais d'écrasement, modèle de sortie de yt-dlp. */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
global.self = global;
const L = require('../plugin/js/liens.js');
const Lb = require('../plugin/js/libres.js');

test('safe names: Windows reserved names and trailing dots / spaces', () => {
  assert.strictEqual(L.safeName('CON'), 'CON_');
  assert.strictEqual(L.safeName('nul.tar'), 'nul_.tar');
  assert.strictEqual(L.safeName('com7'), 'com7_');
  assert.strictEqual(L.safeName('console'), 'console');
  assert.strictEqual(L.safeName('clip. . '), 'clip');
  assert.strictEqual(L.safeName('...'), 'import');
  assert.strictEqual(L.nameFromUrl('https://a.b/aux.mp4', 'mp4'), 'aux_.mp4');
});

test('Google Drive: the file id, or the name sent by the server', () => {
  assert.strictEqual(L.nameFromUrl('https://drive.google.com/uc?export=download&id=1AbC-d_9', 'mp4'), 'drive-1AbC-d_9.mp4');
  assert.strictEqual(L.nameFromDisposition('attachment; filename="Mon clip.mp4"'), 'Mon clip.mp4');
  assert.strictEqual(L.nameFromDisposition('attachment; filename=a.mp3'), 'a.mp3');
  assert.strictEqual(L.nameFromDisposition("attachment; filename=\"x.mp4\"; filename*=UTF-8''Caf%C3%A9.mov"), 'Café.mov');
  assert.strictEqual(L.nameFromDisposition('attachment; filename="../../evil.mp4"'), 'evil.mp4');
  assert.strictEqual(L.nameFromDisposition(''), '');
});

test('free name: an existing file is never overwritten', () => {
  const taken = new Set(['/d/uc.mp4', '/d/uc (2).mp4']);
  assert.strictEqual(L.freeName('/d', 'uc.mp4', p => taken.has(p), path.posix), 'uc (3).mp4');
  assert.strictEqual(L.freeName('/d', 'neuf.mp4', p => taken.has(p), path.posix), 'neuf.mp4');
});

test('yt-dlp output template: % in the folder is escaped', () => {
  const a = L.ytdlpArgs({ url: 'u', mode: 'video', out: 'C:\\Clients\\100% Nike\\', ffmpeg: '' });
  assert.strictEqual(a[a.indexOf('-o') + 1], 'C:\\Clients\\100%% Nike/%(title).70s [%(id)s].%(ext)s');
});

test('tool locations: never the Downloads folder', () => {
  const c = L.candidates('yt-dlp', 'win32', { LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U' });
  assert.ok(!c.some(p => /Downloads/i.test(p)), c.join(' '));
});

test('free tools: generic "main" only in the RR FX folder; vision keeps the shared packages', () => {
  const w = Lb.byId('whisper');
  assert.ok(w.exe.indexOf('main') < 0 && w.ownExe.indexOf('main') >= 0);
  const v = Lb.byId('vision');
  assert.deepStrictEqual(Lb.pipUninstallArgs(v.uninstall).slice(-1), ['transformers']);
});
