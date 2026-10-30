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

test('verifySignature: a pack signed with the RR FX key passes, anything else is refused', () => {
  const crypto = require('crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const bytes = new Uint8Array(Buffer.from('RRFX pack 2.7.0'));
  const sig = crypto.sign(null, Buffer.from(bytes), privateKey).toString('base64');
  assert.strictEqual(I.verifySignature(crypto, bytes, sig, pub), true);
  const tampered = new Uint8Array(Buffer.from('RRFX pack 2.7.1'));
  assert.throws(() => I.verifySignature(crypto, tampered, sig, pub), /Signature invalide/);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.throws(() => I.verifySignature(crypto, bytes, crypto.sign(null, Buffer.from(bytes), other).toString('base64'), pub), /Signature invalide/);
  assert.throws(() => I.verifySignature(crypto, bytes, '', pub), /non signé/);
  // Pas encore de clé dans le panneau : pas de vérification (versions d'avant la signature).
  assert.strictEqual(I.verifySignature(crypto, bytes, '', ''), true);
});

test('installer-mac.sh: valid shell, downloads the pack name that package.js builds, runs the .command', () => {
  const cp = require('child_process');
  const src = fs.readFileSync(path.join(__dirname, '..', 'installer-mac.sh'), 'utf8');
  assert.strictEqual(cp.spawnSync('sh', ['-n', '-c', src]).status, 0);
  assert.match(src, /ZIP="RRFX-\$VERSION-installation\.zip"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package.js'), 'utf8'), /'-installation\.zip'/);
  assert.ok(src.indexOf("'Installer RR FX (Mac).command'") > 0);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'install', 'Installer RR FX (Mac).command')));
});
