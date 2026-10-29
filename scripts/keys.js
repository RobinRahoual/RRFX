#!/usr/bin/env node
/*
 * Crée la paire de clés qui signe les packs de RR FX (à faire une fois, sur TON ordinateur) :
 *   - la clé privée va dans ~/.rrfx-signing-key.pem (jamais dans le dépôt) ;
 *   - la clé publique est écrite dans plugin/js/installer.js (les panneaux vérifient avec).
 * Puis ajoute la clé privée aux secrets du dépôt GitHub (RRFX_SIGNING_KEY) :
 *   gh secret set RRFX_SIGNING_KEY < ~/.rrfx-signing-key.pem
 *
 *   node scripts/keys.js            crée les clés (refuse d'écraser une clé existante)
 *   node scripts/keys.js --force    en refait une (les panneaux déjà installés refuseront les
 *                                   mises à jour en un clic : à réinstaller à la main)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const keyFile = path.join(os.homedir(), '.rrfx-signing-key.pem');
const installer = path.join(__dirname, '..', 'plugin', 'js', 'installer.js');

if (fs.existsSync(keyFile) && !process.argv.includes('--force')) {
  console.error('Une clé existe déjà : ' + keyFile + ' (--force pour en refaire une).');
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const src = fs.readFileSync(installer, 'utf8');
const next = src.replace(/const PUBLIC_KEY = '[^']*';/, "const PUBLIC_KEY = '" + pub + "';");
if (next === src) { console.error('PUBLIC_KEY introuvable dans ' + installer); process.exit(1); }
fs.writeFileSync(installer, next);
console.log('Clé privée : ' + keyFile + ' (garde-la, ne la partage pas)');
console.log('Clé publique écrite dans plugin/js/installer.js');
console.log('\nÀ faire maintenant :');
console.log('  gh secret set RRFX_SIGNING_KEY --repo RobinRahoual/RRFX < ' + keyFile);
console.log('  (ou GitHub > Settings > Secrets and variables > Actions > New repository secret)');
console.log('Puis commit plugin/js/installer.js : les prochaines releases seront signées.');
