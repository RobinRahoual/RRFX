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
  assert.ok(manifest.includes('<Extension Id="com.robinrahoual.rrfx.panel" Version="' + version + '"'), 'manifest extension');
  assert.ok(read('plugin/jsx/host.jsx').includes("var VERSION = '" + version + "';"), 'host.jsx');
  assert.ok(read('plugin/js/host.js').includes("const VERSION = '" + version + "';"), 'host.js');
});

test('index.html loads every panel script, each exists and compiles', () => {
  const html = read('plugin/index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const onDisk = fs.readdirSync(path.join(plugin, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)
    .concat(fs.readdirSync(path.join(plugin, 'js', 'vendor')).filter(f => f.endsWith('.js')).map(f => 'js/vendor/' + f));
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

test('host.jsx is built from src/host', () => {
  const { build } = require('../scripts/build-host.js');
  assert.strictEqual(read('plugin/jsx/host.jsx'), build(), 'node scripts/build-host.js');
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
  assert.strictEqual(typeof ctx.RRFX.apply, 'function');
  // $.evalFile lit le fichier sans BOM : selon le système, « é » ou « · » seraient mal lus
  // (noms « RR FX · … » non reconnus). Tout est en ASCII, les accents en \u00e9.
  const line = src.split('\n').findIndex(l => /[^\x00-\x7f]/.test(l));
  assert.strictEqual(line, -1, 'caractère non ASCII ligne ' + (line + 1));
});

test('the Windows installer keeps CRLF line endings and no parentheses in messages', () => {
  const bat = fs.readFileSync(path.join(root, 'install', 'Installer RR FX (Windows).bat'), 'latin1');
  assert.ok(!/[^\r]\n/.test(bat), 'CRLF');
  bat.split('\r\n').filter(l => /^\s*echo /i.test(l)).forEach(l => assert.ok(!/[()]/.test(l.replace(/\^[()]/g, '')), l));
});

// Un réglage remplacé à chaque lecture (s.x = Object.assign({…}, s.x)) perd les choix faits
// dans l'interface, qui garde une référence vers l'ancien objet : on le complète sur place.
test('panel settings are filled in place, never replaced on read', () => {
  const dir = path.join(root, 'plugin', 'js');
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const bad = src.match(/(\b\w+\.\w+)\s*=\s*Object\.assign\(\{[^;]*\},\s*\1\s*\)/);
    assert.ok(!bad, f + ' : ' + (bad && bad[0]));
  });
});
