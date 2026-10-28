/* Cohérence du projet : versions, fichiers référencés, syntaxe (ES3 pour ExtendScript). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const plugin = path.join(root, 'plugin');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('one version everywhere', () => {
  const version = JSON.parse(read('package.json')).version;
  const manifest = read('plugin/CSXS/manifest.xml');
  assert.ok(manifest.includes('ExtensionBundleVersion="' + version + '"'), 'manifest bundle');
  assert.ok(manifest.includes('<Extension Id="com.cutfx.panel" Version="' + version + '"'), 'manifest extension');
  assert.ok(read('plugin/jsx/host.jsx').includes("var VERSION = '" + version + "';"), 'host.jsx');
  assert.ok(read('plugin/js/host.js').includes("const VERSION = '" + version + "';"), 'host.js');
});

test('index.html loads every panel script, each exists and compiles', () => {
  const html = read('plugin/index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const onDisk = fs.readdirSync(path.join(plugin, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
  assert.deepStrictEqual(scripts.slice().sort(), onDisk.sort());
  assert.strictEqual(scripts[scripts.length - 1], 'js/main.js', 'main.js last');
  scripts.forEach(s => assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(plugin, s), 'utf8'), { filename: s }), s));
});

test('no raw line/paragraph separators (they break regex literals in older engines)', () => {
  listFiles(plugin).filter(f => /\.(js|jsx|html|css)$/.test(f)).forEach(f => {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/[\u2028\u2029]/.test(s), path.relative(root, f));
  });
});

// ExtendScript n'a que l'ES3 : pas de let/const, flèches, gabarits, classes, JSON natif…
test('host.jsx is plain ES3 and runs', () => {
  const src = read('plugin/jsx/host.jsx');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gim]*/g, '/x/');
  [/\b(let|const|class)\s/, /=>/, /`/, /\.\.\./, /\bJSON\./, /\.(forEach|map|filter|indexOf|reduce|some|every|find|trim|keys)\(/, /,\s*[}\]]/].forEach(re => {
    assert.ok(!re.test(code), 'ES3: ' + re + ' → ' + (code.match(re) || [])[0]);
  });
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  assert.strictEqual(typeof ctx.CutFX.apply, 'function');
});

test('the Windows installer keeps CRLF line endings and no parentheses in messages', () => {
  const bat = fs.readFileSync(path.join(root, 'install', 'Installer CutFX (Windows).bat'), 'latin1');
  assert.ok(!/[^\r]\n/.test(bat), 'CRLF');
  bat.split('\r\n').filter(l => /^\s*echo /i.test(l)).forEach(l => assert.ok(!/[()]/.test(l.replace(/\^[()]/g, '')), l));
});
