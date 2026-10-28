/* Ressources : classement des fichiers, indexation d'un dossier, filtres, LUT .cube. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../plugin/js/assets.js');

test('classify: every kind of resource, the rest ignored', () => {
  assert.strictEqual(A.classify('Whoosh 01.WAV'), 'audio');
  assert.strictEqual(A.classify('Teal Orange.cube'), 'lut');
  assert.strictEqual(A.classify('Montserrat-Black.otf'), 'font');
  assert.strictEqual(A.classify('Lower third.mogrt'), 'mogrt');
  assert.strictEqual(A.classify('Light leak 4K.mov'), 'video');
  assert.strictEqual(A.classify('grain.png'), 'image');
  assert.strictEqual(A.classify('Zoom punch.prfpset'), 'preset');
  assert.strictEqual(A.classify('Mes effets.rrfx.json'), 'preset');
  assert.strictEqual(A.classify('notes.txt'), null);
  assert.strictEqual(A.classify('.DS_Store'), null);
  assert.strictEqual(A.classify('~$draft.wav'), null);
  assert.strictEqual(A.baseName('Mes effets.rrfx.json'), 'Mes effets');
});

test('scanFolder: sub-folders, hidden and cache folders skipped, depth and size limits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-assets-'));
  const put = (rel, bytes) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(bytes || 10)); };
  put('SFX/Whoosh/whoosh 1.wav', 100);
  put('SFX/Impacts/hit.mp3');
  put('LUTs/teal.cube');
  put('Fonts/Bebas.ttf');
  put('Fonts/readme.txt');
  put('.hidden/secret.wav');
  put('Adobe Premiere Pro Auto-Save/x.prproj');
  put('a/b/c/d/deep.wav');
  try {
    const r = await A.scanFolder(fs, path, root, {});
    const rels = r.files.map(f => f.rel).sort();
    assert.deepStrictEqual(rels, ['Fonts/Bebas.ttf', 'LUTs/teal.cube', 'SFX/Impacts/hit.mp3', 'SFX/Whoosh/whoosh 1.wav', 'a/b/c/d/deep.wav']);
    assert.strictEqual(r.files.find(f => f.rel === 'SFX/Whoosh/whoosh 1.wav').size, 100);
    assert.ok(r.files.every(f => f.mtime > 0));
    const shallow = await A.scanFolder(fs, path, root, { depth: 2 });
    assert.ok(!shallow.files.some(f => /deep/.test(f.rel)));
    const capped = await A.scanFolder(fs, path, root, { max: 2 });
    assert.strictEqual(capped.files.length, 2);
    assert.strictEqual(capped.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('entries, folders, filters, search and sort', () => {
  const index = {
    '/Users/robin/Pack': { files: [
      { rel: 'SFX/Whoosh/Whoosh 2.wav', type: 'audio', size: 5, mtime: 3 },
      { rel: 'SFX/Whoosh/Whoosh 10.wav', type: 'audio', size: 9, mtime: 1 },
      { rel: 'SFX/Impact.wav', type: 'audio', size: 1, mtime: 2 },
      { rel: 'LUTs/Teal & Orange.cube', type: 'lut', size: 2, mtime: 4 },
      { rel: 'Logo.png', type: 'image', size: 3, mtime: 5 }
    ] }
  };
  const list = A.entries(index, '/');
  assert.strictEqual(list[0].path, '/Users/robin/Pack/SFX/Whoosh/Whoosh 2.wav');
  assert.strictEqual(list[0].rootName, 'Pack');
  assert.strictEqual(list[3].name, 'Teal & Orange');
  const f = A.folders(list);
  assert.deepStrictEqual(f.map(x => [x.label, x.n]), [['Pack', 5], ['Pack / LUTs', 1], ['Pack / SFX', 3], ['Pack / SFX / Whoosh', 2]]);
  const whoosh = f.find(x => x.label === 'Pack / SFX / Whoosh').key;
  assert.deepStrictEqual(A.filter(list, { folder: whoosh }).map(e => e.name), ['Whoosh 2', 'Whoosh 10'], 'natural order');
  assert.deepStrictEqual(A.filter(list, { folder: f.find(x => x.label === 'Pack / SFX').key }).length, 3);
  assert.deepStrictEqual(A.filter(list, { type: 'lut' }).map(e => e.name), ['Teal & Orange']);
  assert.deepStrictEqual(A.filter(list, { search: 'whoosh 10' }).map(e => e.name), ['Whoosh 10']);
  assert.deepStrictEqual(A.filter(list, { search: 'sons' }).length, 3, 'type label is searchable');
  assert.deepStrictEqual(A.filter(list, { sort: 'recent' }).map(e => e.mtime), [5, 4, 3, 2, 1]);
  assert.deepStrictEqual(A.filter(list, { favOnly: true, favs: new Set([list[4].id]) }).map(e => e.name), ['Logo']);
  assert.deepStrictEqual(A.counts(list).audio, 3);
  assert.strictEqual(A.entries({ 'C:\\Pack\\': { files: [{ rel: 'a/b.wav', type: 'audio' }] } }, '\\')[0].path, 'C:\\Pack\\a\\b.wav');
});

test('fromFileList (browser folder picker)', () => {
  const files = [
    { name: 'hit.wav', webkitRelativePath: 'Pack/SFX/hit.wav', size: 3, lastModified: 7 },
    { name: 'x.txt', webkitRelativePath: 'Pack/x.txt', size: 1 },
    { name: 'a.wav', webkitRelativePath: 'Pack/.git/a.wav', size: 1 }
  ];
  const idx = A.fromFileList(files);
  assert.deepStrictEqual(Object.keys(idx), ['Pack']);
  assert.deepStrictEqual(idx.Pack.files.map(f => f.rel), ['SFX/hit.wav']);
  assert.strictEqual(A.entries(idx)[0].file, files[0]);
});

test('LUT .cube: 3D identity, a real grade, 1D, domain, errors', () => {
  const N = 2, lines = ['TITLE "Id"', 'LUT_3D_SIZE 2'];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) lines.push(r + ' ' + g + ' ' + b);
  const id = A.parseCube(lines.join('\n'));
  assert.strictEqual(id.title, 'Id');
  const px = new Uint8ClampedArray([10, 128, 250, 255, 0, 0, 0, 255]);
  A.applyLut(px, id);
  assert.deepStrictEqual(Array.from(px), [10, 128, 250, 255, 0, 0, 0, 255]);
  // Inversion des couleurs.
  const inv = ['LUT_3D_SIZE 2'];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) inv.push((1 - r) + ' ' + (1 - g) + ' ' + (1 - b));
  const p2 = new Uint8ClampedArray([0, 255, 100, 255]);
  A.applyLut(p2, A.parseCube(inv.join('\r\n')));
  assert.deepStrictEqual(Array.from(p2), [255, 0, 155, 255]);
  // 1D : rouge mis à zéro.
  const one = A.parseCube('LUT_1D_SIZE 2\n0 0 0\n0 1 1\n');
  const p3 = new Uint8ClampedArray([200, 200, 200, 255]);
  A.applyLut(p3, one);
  assert.deepStrictEqual(Array.from(p3), [0, 200, 200, 255]);
  // Domaine 0-2 : 255 tombe au milieu de la LUT.
  const dom = A.parseCube('LUT_1D_SIZE 3\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n0 0 0\n0.5 0.5 0.5\n1 1 1\n');
  const p4 = new Uint8ClampedArray([255, 0, 0, 255]);
  A.applyLut(p4, dom);
  assert.strictEqual(p4[0], 128);
  assert.throws(() => A.parseCube('LUT_3D_SIZE 4\n0 0 0\n'), /illisible/);
  assert.throws(() => A.parseCube('bonjour'), /illisible/);
});

test('formatSize', () => {
  assert.strictEqual(A.formatSize(512), '512 o');
  assert.strictEqual(A.formatSize(1536), '1,5 Ko');
  assert.strictEqual(A.formatSize(25 * 1048576), '25 Mo');
  assert.strictEqual(A.formatSize(3 * 1073741824), '3,0 Go');
});
