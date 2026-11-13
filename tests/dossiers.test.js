/* 2.19 : dossier assets du projet rangé tout seul (catégories, sons MUSIQUE / SFX, vrac). */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const D = require('../plugin/js/dossiers.js');
const { makeEnv } = require('./sim');

test('categories: by type, sounds split into MUSIQUE / SFX / VOIX', () => {
  assert.strictEqual(D.categoryOf('clip.MP4'), 'VIDEOS');
  assert.strictEqual(D.categoryOf('logo.png'), 'IMAGES');
  assert.strictEqual(D.categoryOf('titre.mogrt'), 'GRAPHIQUES');
  assert.strictEqual(D.categoryOf('sous-titres.srt'), 'SOUS-TITRES');
  assert.strictEqual(D.categoryOf('look.cube'), 'LUTS');
  assert.strictEqual(D.categoryOf('Montserrat.ttf'), 'POLICES');
  assert.strictEqual(D.categoryOf('notes.txt'), 'DIVERS');
  // Sons : durée connue (yt-dlp), sinon d'après la taille, sinon d'après le nom.
  assert.strictEqual(D.categoryOf('son.mp3', { duration: 180 }), 'MUSIQUE');
  assert.strictEqual(D.categoryOf('son.mp3', { duration: 3 }), 'SFX');
  assert.strictEqual(D.categoryOf('son.mp3', { bytes: 192000 / 8 * 200 }), 'MUSIQUE', '≈ 200 s at 192 kb/s');
  assert.strictEqual(D.categoryOf('whoosh.wav', { bytes: 48000 * 4 * 2 }), 'SFX', '2 s of 48 kHz stereo');
  assert.strictEqual(D.categoryOf('Lofi beat.m4a'), 'MUSIQUE');
  assert.strictEqual(D.categoryOf('impact.ogg'), 'SFX');
  assert.strictEqual(D.categoryOf('Voix off 1.wav', { duration: 120 }), 'VOIX');
  assert.strictEqual(D.categoryOf('take.wav', { kind: 'voice' }), 'VOIX');
  assert.strictEqual(D.durationOf('RRFXDUR=212.5'), 212.5);
  assert.strictEqual(D.durationOf('/path/file.mp3'), null);
  assert.ok(D.DURATION_ARGS.includes('before_dl:RRFXDUR=%(duration)s'));
});

test('folders next to the project, Mac and Windows', () => {
  assert.deepStrictEqual(D.assetsDir('/Users/r/Nike/Montage.prproj', 'MUSIQUE', path.posix), { dir: '/Users/r/Nike/assets/MUSIQUE', bin: 'assets/MUSIQUE', sub: 'MUSIQUE' });
  assert.strictEqual(D.assetsDir('/Users/r/Nike/Montage.prproj', 'VOIX', path.posix, 'Voix off').dir, '/Users/r/Nike/assets/VOIX/Voix off');
  assert.strictEqual(D.assetsDir('C:\\Clip\\Clip.prproj', 'VIDEOS', path.win32).dir, 'C:\\Clip\\assets\\VIDEOS');
  assert.strictEqual(D.assetsDir('C:\\Clip\\Clip.prproj', 'NIMPORTE', path.win32).sub, 'DIVERS');
  assert.strictEqual(D.assetsDir('', 'VIDEOS', path.posix), null);
  assert.strictEqual(D.assetsRoot('/P/Clip.prproj', path.posix), '/P/assets');
});

test('loose files: sorted into categories, used ones flagged for relinking, names never overwritten', () => {
  const root = '/P/assets';
  const files = [
    { name: 'clip.mp4', bytes: 1e7 }, { name: 'whoosh.wav', bytes: 3e5 }, { name: 'musique.mp3', bytes: 6e6 },
    { name: 'logo.png', bytes: 1e4 }, { name: 'VIDEOS', bytes: 0 }, { name: 'dl.mp4.part', bytes: 5 }, { name: '.DS_Store', bytes: 5 },
    { name: 'b.mp4', bytes: 1e6 }
  ];
  const used = p => p === '/P/assets/clip.mp4';
  const exists = p => p === '/P/assets/VIDEOS/b.mp4';
  const plan = D.planSort(root, files, path.posix, used, exists);
  assert.deepStrictEqual(plan.map(m => [m.from.split('/').pop(), m.to, m.used]), [
    ['clip.mp4', '/P/assets/VIDEOS/clip.mp4', true],
    ['whoosh.wav', '/P/assets/SFX/whoosh.wav', false],
    ['musique.mp3', '/P/assets/MUSIQUE/musique.mp3', false],
    ['logo.png', '/P/assets/IMAGES/logo.png', false],
    ['b.mp4', '/P/assets/VIDEOS/b (2).mp4', false]
  ]);
});

test('host: files under assets/<CAT>/ go to the bin assets › CAT; moved files are relinked', () => {
  const env = makeEnv(25);
  const root = env.ctx.app.project.rootItem, kids = b => Array.from({ length: b.children.numItems }, (_, i) => b.children[i]);
  const binPath = it => { const out = []; const find = (b, trail) => kids(b).forEach(c => { if (c === it) out.push(trail.join('/')); if (c.type === 2) find(c, trail.concat(c.name)); }); find(root, []); return out[0]; };
  let r = env.call('placeAsset', { path: '/P/assets/MUSIQUE/Lofi.mp3', kind: 'audio', name: 'Lofi', times: [1] });
  assert.ok(r.ok, r.error);
  r = env.call('placeAsset', { path: '/P/assets/VIDEOS/Détourages/a (détouré).mov', kind: 'video', name: 'a', times: [2] });
  assert.ok(r.ok, r.error);
  r = env.call('placeAsset', { path: '/Users/r/Documents/RRFX/Sons/RRFX Whoosh.wav', kind: 'audio', name: 'w', times: [3] });
  assert.ok(r.ok, r.error);
  const items = [];
  const all = b => kids(b).forEach(c => { if (c.type === 1) items.push(c); if (c.type === 2) all(c); });
  all(root);
  const byPath = p => items.find(i => i.getMediaPath() === p);
  assert.strictEqual(binPath(byPath('/P/assets/MUSIQUE/Lofi.mp3')), 'assets/MUSIQUE');
  assert.strictEqual(binPath(byPath('/P/assets/VIDEOS/Détourages/a (détouré).mov')), 'assets/VIDEOS');
  assert.strictEqual(binPath(byPath('/Users/r/Documents/RRFX/Sons/RRFX Whoosh.wav')), 'RR FX Ressources', 'outside a project: as before');
  const pm = env.call('projectMedia', {});
  assert.ok(pm.paths.includes('/P/assets/MUSIQUE/Lofi.mp3'));
  env.disk.add('/P/assets/MUSIQUE/Lofi (2).mp3');
  r = env.call('relinkMedia', { moves: [{ from: '/P/assets/MUSIQUE/Lofi.mp3', to: '/P/assets/MUSIQUE/Lofi (2).mp3' }, { from: '/P/assets/VIDEOS/Détourages/a (détouré).mov', to: '/nowhere.mov' }] });
  assert.deepStrictEqual([r.done, r.failed], [1, ['/P/assets/VIDEOS/Détourages/a (détouré).mov']]);
  assert.ok(byPath('/P/assets/MUSIQUE/Lofi (2).mp3'));
});

test('other projects in the folder; auto-sort waits for copies and spares older files when shared', () => {
  assert.deepStrictEqual(D.otherProjects('/P/Montage.prproj', ['Montage.prproj', 'Teaser.PRPROJ', '._Teaser.prproj', 'assets', 'notes.txt']), ['Teaser.PRPROJ']);
  assert.deepStrictEqual(D.otherProjects('C:\\P\\montage.prproj', ['Montage.prproj']), []);
  const w = {};
  const f = (name, bytes, mtime) => ({ name, bytes, mtime });
  // Premier tour : rien (on ne sait pas encore ce qui est en copie).
  assert.deepStrictEqual(D.readyToSort([f('old.mp4', 10, 1)], w, true), []);
  // Un fichier arrive, un autre grossit encore : seul le fichier stable et nouveau est rangé.
  assert.deepStrictEqual(D.readyToSort([f('old.mp4', 10, 1), f('new.mp4', 5, 2), f('copie.mov', 1, 3)], w, true), []);
  assert.deepStrictEqual(D.readyToSort([f('old.mp4', 10, 1), f('new.mp4', 5, 2), f('copie.mov', 9, 4)], w, true), ['new.mp4']);
  // Sans autre projet : les anciens fichiers aussi.
  assert.deepStrictEqual(D.readyToSort([f('old.mp4', 10, 1), f('copie.mov', 9, 4)], w, false), ['old.mp4', 'copie.mov']);
});
