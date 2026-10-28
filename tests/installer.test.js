/* Mise à jour en un clic : pack vérifié, fichiers remplacés, retour arrière si ça échoue. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Zip = require('../plugin/js/stylepack.js');
const I = require('../plugin/js/installer.js');

const enc = s => new TextEncoder().encode(s);
const pack = (version, extra) => Zip.zip([
  { name: 'RRFX-' + version + '/LISEZMOI.txt', data: enc('lis-moi') },
  { name: 'RRFX-' + version + '/RRFX/CSXS/manifest.xml', data: enc('<ExtensionManifest ExtensionBundleVersion="' + version + '">') },
  { name: 'RRFX-' + version + '/RRFX/index.html', data: enc('<html>' + version) },
  { name: 'RRFX-' + version + '/RRFX/jsx/host.jsx', data: enc('var VERSION = "' + version + '";') },
  { name: 'RRFX-' + version + '/RRFX/js/main.js', data: enc('main ' + version) }
].concat(extra || []), b => new Uint8Array(zlib.deflateRawSync(Buffer.from(b))));
const inflate = b => new Uint8Array(zlib.inflateRawSync(Buffer.from(b)));

test('the installation pack is checked: right folder, complete, right version', () => {
  const files = I.filesOf(pack('2.0.0'), inflate, '2.0.0');
  assert.deepStrictEqual(files.map(f => f.rel).sort(), ['CSXS/manifest.xml', 'index.html', 'js/main.js', 'jsx/host.jsx']);
  assert.throws(() => I.filesOf(pack('1.9.0'), inflate, '2.0.0'), /version 1\.9\.0/);
  assert.throws(() => I.filesOf(Zip.zip([{ name: 'autre/a.txt', data: enc('x') }]), inflate), /pas un pack d'installation/);
  assert.throws(() => I.filesOf(Zip.zip([{ name: 'X/RRFX/CSXS/manifest.xml', data: enc('m') }]), inflate), /incomplet/);
  assert.throws(() => I.filesOf(pack('2.0.0', [{ name: 'RRFX-2.0.0/RRFX/../../evil.js', data: enc('x') }]), inflate), /chemin/);
});

test('panel folder from the page address (Mac and Windows)', () => {
  assert.strictEqual(I.extensionDir('file:///Users/robin/Library/Application%20Support/Adobe/CEP/extensions/RRFX/index.html'), '/Users/robin/Library/Application Support/Adobe/CEP/extensions/RRFX');
  assert.strictEqual(I.extensionDir('file:///C:/Users/Robin/AppData/Roaming/Adobe/CEP/extensions/RRFX/index.html'), 'C:\\Users\\Robin\\AppData\\Roaming\\Adobe\\CEP\\extensions\\RRFX');
  assert.strictEqual(I.extensionDir('http://localhost/index.html'), null);
});

test('install replaces the panel files, keeps a backup, and rolls back on failure', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-inst-')), dir = path.join(tmp, 'RRFX'), backup = path.join(tmp, 'sauvegarde');
  fs.mkdirSync(path.join(dir, 'CSXS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CSXS', 'manifest.xml'), 'old');
  fs.writeFileSync(path.join(dir, 'index.html'), 'old');
  const n = I.install(fs, path, dir, I.filesOf(pack('2.0.0'), inflate, '2.0.0'), backup);
  assert.strictEqual(n, 4);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<html>2.0.0');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'jsx', 'host.jsx'), 'utf8'), 'var VERSION = "2.0.0";');
  assert.strictEqual(fs.readFileSync(path.join(backup, 'index.html'), 'utf8'), 'old');
  // Échec au milieu (un dossier à la place d'un fichier) : tout revient comme avant.
  const files = I.filesOf(pack('2.1.0'), inflate, '2.1.0');
  fs.rmSync(path.join(dir, 'js', 'main.js'));
  fs.mkdirSync(path.join(dir, 'js', 'main.js'));
  assert.throws(() => I.install(fs, path, dir, files, backup), /annulée/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<html>2.0.0', 'rolled back');
  assert.throws(() => I.install(fs, path, path.join(tmp, 'nope'), files, backup), /introuvable/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
