#!/usr/bin/env node
/*
 * Signe un pack d'installation (ed25519) : écrit <fichier>.sig (base64), que le panneau vérifie
 * avant une mise à jour en un clic. La clé privée vient de RRFX_SIGNING_KEY (secret GitHub) ou
 * de ~/.rrfx-signing-key.pem (scripts/keys.js).
 *
 *   node scripts/sign.js dist/RRFX-2.7.0-installation.zip
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { verifySignature, PUBLIC_KEY } = require('../plugin/js/installer.js');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Fichier à signer introuvable : ' + file); process.exit(1); }
const pem = process.env.RRFX_SIGNING_KEY || (fs.existsSync(path.join(os.homedir(), '.rrfx-signing-key.pem')) ? fs.readFileSync(path.join(os.homedir(), '.rrfx-signing-key.pem'), 'utf8') : '');
if (!pem) { console.error('Clé privée absente (RRFX_SIGNING_KEY ou ~/.rrfx-signing-key.pem).'); process.exit(1); }
const bytes = fs.readFileSync(file);
const sig = crypto.sign(null, bytes, crypto.createPrivateKey(pem)).toString('base64');
// La signature doit passer la vérification du panneau, avec la clé publique du dépôt.
if (!PUBLIC_KEY) { console.error('Aucune clé publique dans plugin/js/installer.js : node scripts/keys.js'); process.exit(1); }
verifySignature(crypto, new Uint8Array(bytes), sig);
fs.writeFileSync(file + '.sig', sig + '\n');
console.log(file + '.sig');
