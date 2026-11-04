/* Premiere lit host.jsx en ExtendScript (ES3) : un mot réservé d'ES3 (native, class, static…)
   employé comme nom de variable ou de propriété empêche tout le script de se charger
   (« Script Premiere non chargé », 2.16.0). Les chaînes et commentaires sont ignorés ;
   une propriété réservée s'écrit entre guillemets : o['static']. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RESERVED = ['abstract', 'boolean', 'byte', 'char', 'class', 'const', 'debugger', 'double', 'enum', 'export', 'extends',
  'final', 'float', 'goto', 'implements', 'import', 'int', 'interface', 'let', 'long', 'native', 'package', 'private',
  'protected', 'public', 'short', 'static', 'super', 'synchronized', 'throws', 'transient', 'volatile', 'yield'];

// Le code sans commentaires, chaînes ni expressions régulières (remplacés par des espaces).
function codeOnly(src) {
  let out = '', i = 0, prev = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; out += '""'; prev = '"'; continue;
    }
    // Une expression régulière commence après un opérateur ou une parenthèse ouvrante.
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prev)) {
      i++;
      let cls = false;
      while (i < src.length && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
      i++;
      while (/[gimsuy]/.test(src[i] || '')) i++;
      out += '/r/'; prev = '/'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function reservedUses(src) {
  const code = codeOnly(src), re = new RegExp('\\b(' + RESERVED.join('|') + ')\\b', 'g'), lines = [];
  let m;
  while ((m = re.exec(code))) lines.push(code.slice(0, m.index).split('\n').length + ' : ' + m[1]);
  return lines;
}

test('host.jsx: no ES3 reserved word outside strings (ExtendScript would refuse the whole file)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'jsx', 'host.jsx'), 'utf8');
  assert.deepStrictEqual(reservedUses(src), []);
});

test('the check catches what broke 2.16.0, and ignores strings, comments and regexes', () => {
  assert.deepStrictEqual(reservedUses('var a = 1, native = 2;'), ['1 : native']);
  assert.deepStrictEqual(reservedUses('x = p.static;'), ['1 : static']);
  assert.deepStrictEqual(reservedUses("x = p['static']; // native\n/* class */ y = /class|int/.test(s);"), []);
});
