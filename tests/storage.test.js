'use strict';
/* Bibliothèque sur disque : liste des fichiers d'un dossier (ressources, dossiers surveillés). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

function load() {
  const self = { require };
  const ctx = vm.createContext({ self, require, process, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'js', 'storage.js'), 'utf8'), ctx);
  return self.RRFXStorage;
}

test('listFiles : récursif, profondeur et nombre limités, fichiers cachés ignorés', () => {
  const S = load(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-lf-'));
  fs.mkdirSync(path.join(tmp, 'a', 'b'), { recursive: true });
  ['x.mov', 'a/y.wav', 'a/b/z.png', 'a/.cache.mov', 'a/note.txt'].forEach(f => fs.writeFileSync(path.join(tmp, f), ''));
  const rel = l => Array.from(l, p => path.relative(tmp, p).split(path.sep).join('/')).sort();
  assert.deepStrictEqual(rel(S.listFiles(tmp, /\.(mov|wav|png)$/i, 100, 3)), ['a/b/z.png', 'a/y.wav', 'x.mov']);
  assert.deepStrictEqual(rel(S.listFiles(tmp, /\.(mov|wav|png)$/i, 100, 0)), ['x.mov']);
  assert.strictEqual(S.listFiles(tmp, /\.(mov|wav|png)$/i, 2, 3).length, 2);
  assert.strictEqual(S.listFiles(path.join(tmp, 'absent'), /./, 10, 3).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
