#!/usr/bin/env node
/*
 * Assemble le script Premiere : src/host/*.jsx (une partie par domaine, dans l'ordre des noms)
 * → plugin/jsx/host.jsx, le seul fichier que charge Premiere (ExtendScript ES3, ASCII).
 *
 *   node scripts/build-host.js           écrit plugin/jsx/host.jsx
 *   node scripts/build-host.js --check   vérifie qu'il est à jour (tests)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src', 'host');
const out = path.join(root, 'plugin', 'jsx', 'host.jsx');

function build() {
  const parts = fs.readdirSync(dir).filter(n => /\.jsx$/.test(n)).sort();
  const text = parts.map(n => fs.readFileSync(path.join(dir, n), 'utf8')).join('');
  // Premiere lit ce fichier en ASCII : un accent casserait le chargement.
  const bad = text.split('\n').findIndex(l => /[^\x00-\x7f]/.test(l));
  if (bad >= 0) throw new Error('host.jsx : caractère non ASCII ligne ' + (bad + 1));
  return text;
}

if (require.main === module) {
  const text = build();
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text;
    if (!same) { console.error('plugin/jsx/host.jsx n\'est pas à jour : node scripts/build-host.js'); process.exit(1); }
  } else {
    fs.writeFileSync(out, text);
    console.log('plugin/jsx/host.jsx (' + text.split('\n').length + ' lignes)');
  }
}

module.exports = { build };
