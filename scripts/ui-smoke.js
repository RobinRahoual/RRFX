#!/usr/bin/env node
/*
 * Test d'interface : ouvre le panneau en mode démo dans Chromium (Playwright),
 * parcourt les onglets et les actions principales, et échoue à la moindre
 * erreur JavaScript. Nécessite Playwright : npm i -D playwright && npx playwright install chromium
 *
 *   node scripts/ui-smoke.js [dossier-captures]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

// Fichiers de test : une musique à 120 BPM (kick toutes les 0,5 s) et un overlay PNG.
function makeWav(file, seconds) {
  const sr = 22050, n = sr * seconds, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = t % 0.5;
    const v = Math.exp(-k * 30) * Math.sin(2 * Math.PI * 60 * k) * 0.8 + Math.sin(2 * Math.PI * 440 * t) * 0.03;
    data.writeInt16LE(Math.round(v * 32000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
function makePng(file, w, hgt) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const len = Buffer.alloc(4), c = Buffer.alloc(4), tb = Buffer.concat([Buffer.from(type), body]); len.writeUInt32BE(body.length); c.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 255; raw[o + 1] = 150 + (x % 100); raw[o + 2] = 40; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-ui-'));
const wav = path.join(tmp, 'musique.wav'), png = path.join(tmp, 'light-leak.png');
makeWav(wav, 10);
makePng(png, 64, 36);

const shots = process.argv[2] || null;
const url = 'file://' + path.join(__dirname, '..', 'plugin', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const snap = async name => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const step = async (label, fn) => {
    try { await fn(); } catch (e) {
      errors.push(label + ' : ' + e.message.split('\n')[0]);
      if (process.env.RRFX_DEBUG) console.log('[' + label + ']', e.message.slice(0, 900), await page.evaluate(() => document.getElementById('modal-root').innerHTML.slice(0, 600)));
    }
  };

  // Bibliothèque en ligne : GitHub remplacé par deux presets publiés.
  const zipCode = items => 'RRFX0:' + Buffer.from(JSON.stringify({ rrfx: 1, items })).toString('base64url');
  const issues = [
    { number: 12, title: '[Preset] Zoom drop', state: 'open', html_url: 'https://github.com/RobinRahoual/RRFX/issues/12', created_at: '2026-10-01T10:00:00Z', user: { login: 'monteuse' }, reactions: { '+1': 7 },
      body: '### Nom\n\nZoom drop\n\n### Description\n\nPour les drops en 120 BPM\n\n### Code RR FX\n\n' + zipCode([{ type: 'preset', name: 'Zoom drop', cat: 'zooms', data: { base: 'zoom-in', params: { frames: 6 } } }]) },
    { number: 13, title: '[Preset] Rampe douce', state: 'open', html_url: 'https://github.com/RobinRahoual/RRFX/issues/13', created_at: '2026-10-05T10:00:00Z', user: { login: 'robin' }, reactions: { '+1': 2 },
      body: '### Nom\n\nRampe douce\n\n### Description\n\n_No response_\n\n### Code RR FX\n\n' + zipCode([{ type: 'ramp', name: 'Rampe douce', data: { points: [[0, 1], [1, 0.3]], frames: 12, segments: 8 } }]) }
  ];
  await page.route('https://api.github.com/**', route => {
    const u = route.request().url();
    if (/\/issues\?/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(issues) });
    return route.fulfill({ status: 404, body: '{}' });
  });
  // Les pages GitHub ouvertes par le panneau (formulaire de publication) restent hors ligne.
  await page.context().route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>GitHub</p>' }));
  // L'accueil de la première ouverture a son propre test.
  await page.addInitScript(() => { try { localStorage.setItem('rrfx-nowelcome', '1'); } catch (e) { /* stockage indisponible */ } });
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.click('.tab[data-tab=effects]');
  await page.waitForTimeout(300);
  await snap('1-effets');

  await step('effet + paramètre', async () => {
    await page.click('.card:has-text("Zoom rotation")');
    const hot = page.locator('.row:has(.row-label:text-is("Zoom")) .hot');
    await hot.scrollIntoViewIfNeeded();
    const box = await hot.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 5 + i * 5, box.y + 5);
    await page.mouse.up();
    if ((await hot.textContent()) !== '60') throw new Error('la valeur glissée devrait passer à 60');
  });
  await step('appliquer sur les marqueurs', async () => {
    await page.selectOption('.section:has-text("Placement") select >> nth=0', 'markers');
    await page.click('#cta');
    await page.waitForSelector('#status.ok, #status.warn', { timeout: 8000 });
    await snap('2-applique');
  });
  await step('annuler', async () => {
    await page.click('#undo');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok', { timeout: 5000 });
  });
  await step('preset', async () => {
    await page.click('.effect-tools .action:has-text("Preset")');
    await page.fill('.modal input', 'Mon spin');
    await page.click('.modal .cta');
    await page.waitForSelector('.badge:has-text("preset")', { timeout: 3000 });
  });
  await step('speed ramp', async () => {
    await page.click('.tab[data-tab=ramp]');
    const c = await page.locator('.ramp-canvas').boundingBox();
    await page.mouse.dblclick(c.x + c.width * 0.3, c.y + c.height * 0.8);
    await page.click('#cta');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok', { timeout: 5000 });
    await snap('3-rampe');
  });
  await step('capture', async () => {
    await page.click('.tab[data-tab=mine]');
    await page.click('#cta');
    await page.waitForSelector('.list-item', { timeout: 3000 });
    await snap('4-mes-effets');
  });
  await step('overlay', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('.chips .action:has-text("Overlays")');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.add-card:has-text("Ajouter des overlays")')]);
    await chooser.setFiles(png);
    await page.waitForSelector('.badge:has-text("overlay")', { timeout: 3000 });
    if (await page.locator('.effect-tools .action:has-text("Preset")').count()) throw new Error('pas de preset possible pour un overlay');
    await page.click('#cta');
    await page.waitForSelector('#status.ok, #status.warn', { timeout: 8000 });
    await snap('6-overlay');
  });
  await step('musique : analyse et marqueurs', async () => {
    await page.click('.tab[data-tab=music]');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action:has-text("Choisir un fichier")')]);
    await chooser.setFiles(wav);
    await page.waitForSelector('#status.ok:has-text("Musique analysée")', { timeout: 10000 });
    const detail = await page.textContent('#status-detail');
    const n = Number((/(\d+) temps fort/.exec(detail) || [])[1]);
    if (!(n >= 16 && n <= 22)) throw new Error('environ 20 temps forts attendus, ' + detail);
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("marqueurs posés")', { timeout: 5000 });
    await snap('7-musique');
  });
  await step('multicam', async () => {
    await page.click('.action:has-text("Une des caméras")');
    await page.waitForSelector('.row-label:has-text("Caméra de référence")', { timeout: 2000 });
    await page.click('.action:has-text("Alterner les caméras")');
    await page.waitForSelector('#status.ok:has-text("caméras")', { timeout: 5000 });
  });
  await step('pack d\'overlays', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('.chips .action:has-text("Overlays")');
    await page.hover('.card:has-text("Bokeh chaud")');
    await page.click('.card:has-text("VHS")');
    await page.waitForSelector('.note:has-text("fourni avec RR FX")', { timeout: 2000 });
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("VHS appliqué")', { timeout: 8000 });
  });
  await step('ressources', async () => {
    const pack = path.join(tmp, 'Pack démo');
    require('./demo-assets.js').make(pack);
    await page.click('.tab[data-tab=assets]');
    if ((await page.textContent('#cta')) !== 'Lier un dossier…') throw new Error('bouton principal inattendu');
    await require('./demo-files.js').addFolder(page, pack);
    await page.waitForSelector('#res-grid .card', { timeout: 3000 });
    const n = await page.locator('#res-grid .card').count();
    if (n < 18) throw new Error(n + ' ressources affichées');
    await page.fill('.search .textfield', 'whoosh rapide');
    await page.waitForFunction(() => document.querySelectorAll('#res-grid .card').length === 1, null, { timeout: 2000 });
    await page.click('#res-grid .card');
    await page.click('#res-inspector .action:has-text("Poser sur chaque marqueur")');
    await page.waitForSelector('#status.ok:has-text("posé")', { timeout: 5000 });
    await page.fill('.search .textfield', '');
    await page.click('.chips .action:has-text("LUTs")');
    await page.click('#res-grid .card:has-text("Teal")');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("Lumetri")', { timeout: 5000 });
    await page.click('.chips .action:has-text("Presets")');
    await page.click('#res-grid .card:has-text("Mes transitions")');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("ajouté")', { timeout: 3000 });
    await page.click('.chips .action:has-text("Images")');
    await page.click('#res-grid .card:has-text("Light leak orange")');
    await page.click('#res-inspector .action:has-text("Utiliser comme overlay")');
    await page.waitForSelector('.tab.on[data-tab=effects]', { timeout: 3000 });
    await page.waitForSelector('.badge:has-text("overlay")', { timeout: 3000 });
  });
  await step('effets sur les temps forts (sans marqueurs)', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('.chips .action:text-is("Tout")');
    await page.click('.card:has-text("Flash blanc")');
    await page.selectOption('.section:has-text("Placement") select >> nth=0', 'beats');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("zones"), #status.warn:has-text("zones")', { timeout: 10000 });
    await page.selectOption('.section:has-text("Placement") select >> nth=0', 'markers');
  });
  await step('rampe calée sur le tempo', async () => {
    await page.click('.tab[data-tab=ramp]');
    await page.click('.row:has-text("Sur le tempo") .action:text-is("1 temps")');
    await page.waitForSelector('#status.ok:has-text("Rampe de")', { timeout: 5000 });
    const t = await page.textContent('#status-title');
    if (!/Rampe de 1[23] images/.test(t)) throw new Error('1 temps à 120 BPM, 25 i/s ≈ 12,5 images : ' + t);
  });
  await step('couleur', async () => {
    await page.click('.tab[data-tab=color]');
    await page.waitForSelector('.lr-look');
    await page.click('.lr-look:has-text("Nuit bleue")');
    const t = page.locator('.lr-row:has(.lr-label:text-is("Exposition")) .lr-track'), bx = await t.boundingBox();
    await page.mouse.move(bx.x + bx.width / 2, bx.y + 2); await page.mouse.down();
    await page.mouse.move(bx.x + bx.width * 0.55, bx.y + 2, { steps: 4 }); await page.mouse.up();
    if ((await page.textContent('.lr-row:has(.lr-label:text-is("Exposition")) .lr-val')) === '0,00') throw new Error('curseur Exposition immobile');
    const [cube] = await Promise.all([page.waitForEvent('download'), page.click('.action:has-text("Exporter .cube")')]);
    const cubeText = fs.readFileSync(await cube.path(), 'utf8');
    if (!/LUT_3D_SIZE 33/.test(cubeText)) throw new Error('LUT exportée invalide');
    const [dctl] = await Promise.all([page.waitForEvent('download'), page.click('.action:has-text("Exporter DCTL")')]);
    if (!/DEFINE_UI_PARAMS\(exposure/.test(fs.readFileSync(await dctl.path(), 'utf8'))) throw new Error('DCTL exporté invalide');
    await page.click('.action:has-text("Enregistrer le look")');
    await page.fill('.modal input', 'Nuit perso');
    await page.click('.modal .cta');
    await page.waitForSelector('.lr-look:has-text("Nuit perso")', { timeout: 3000 });
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("Look posé")', { timeout: 5000 });
    await page.click('.tab[data-tab=mine]');
    await page.click('.list-item:has-text("Nuit perso") .action:text-is("Ouvrir")');
    await page.waitForSelector('.tab.on[data-tab=color]', { timeout: 3000 });
  });
  await step('conversion log', async () => {
    await page.click('.tab[data-tab=color]');
    // Caméra 1 : Sony A7 III, S-Log3, LUT du fabricant importée.
    await page.click('.action:has-text("+ Ajouter une caméra")');
    await page.selectOption('.conv-form .row:has-text("Marque") select', 'sony');
    await page.fill('.conv-form .row:has-text("Modèle") input', 'A7 III');
    if (!(await page.isDisabled('.conv-form .action:has-text("Enregistrer la caméra")'))) throw new Error('enregistrable sans LUT');
    const cube = path.join(tmp, 'SLog3SGamut3Cine-to-709.cube');
    fs.writeFileSync(cube, 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.conv-form .action:has-text("Importer la LUT")')]);
    await chooser.setFiles(cube);
    await page.waitForSelector('.conv-form .note:has-text("SLog3SGamut3Cine-to-709.cube")', { timeout: 3000 });
    await page.click('.conv-form .action:has-text("Enregistrer la caméra")');
    await page.waitForSelector('.conv-cam.on:has-text("Sony A7 III S-Log3")', { timeout: 3000 });
    // Caméra 2 : iPhone en Apple Log, LUT calculée, exposée à +1 IL.
    await page.click('.action:has-text("+ Ajouter une caméra")');
    await page.selectOption('.conv-form .row:has-text("Marque") select', 'apple');
    await page.fill('.conv-form .row:has-text("Modèle") input', 'iPhone 16 Pro');
    await page.click('.conv-form .action:text-is("Calculée")');
    await page.selectOption('.conv-form .row:has-text("Exposé à") select', '1');
    await page.click('.conv-form .action:has-text("Enregistrer la caméra")');
    await page.waitForSelector('.conv-cam.on:has-text("Apple iPhone 16 Pro Apple Log")', { timeout: 3000 });
    if ((await page.locator('.conv-cam').count()) !== 2) throw new Error('deux caméras attendues');
    // Aperçu converti puis un clic.
    await page.click('.lr-panel:has-text("Conversion LOG") label.checkbox:has-text("Aperçu en LOG")');
    await page.click('.conv-go');
    await page.waitForSelector('#status.ok:has-text("Rec.709 · Apple iPhone 16 Pro Apple Log")', { timeout: 5000 });
    // Raccourci L avec la caméra Sony.
    await page.click('.conv-cam:has-text("Sony A7 III")');
    await page.click('#status-close').catch(() => {});
    await page.locator('body').press('l');
    await page.waitForSelector('#status.ok:has-text("Rec.709 · Sony A7 III S-Log3")', { timeout: 5000 });
    const saved = await page.evaluate(() => window.RRFXApp.settings().logconv);
    if (saved.cams.length !== 2 || saved.cams[0].lutName !== 'SLog3SGamut3Cine-to-709.cube' || saved.cams[1].ev !== 1) throw new Error('caméras mal enregistrées : ' + JSON.stringify(saved));
  });
  await step('conversion par caméra et correction auto', async () => {
    await page.click('.tab[data-tab=color]');
    await page.click('.lr-panel:has-text("Conversion LOG") .action:text-is("Reconnue par plan")');
    await page.click('.lr-panel:has-text("Conversion LOG") label.checkbox:has-text("expo et balance")');
    await page.click('.conv-go');
    await page.waitForSelector('#status.ok:has-text("Rec.709 · 2 caméras")', { timeout: 8000 });
    const d = await page.evaluate(() => document.getElementById('status-title').textContent + ' ' + document.getElementById('status-detail').textContent);
    if (!/1 non reconnu/.test(d) || !/\(3\)/.test(d) || !/Expo et balance/.test(d)) throw new Error('détail inattendu : ' + d);
    await page.click('.lr-panel:has-text("Conversion LOG") .action:text-is("Celle cochée")');
    // Panneau Expo, balance et raccord.
    await page.click('.lr-head:has-text("Expo, balance et raccord")');
    await page.click('.lr-panel:has-text("Expo, balance") .action:text-is("Corriger les plans")');
    await page.waitForSelector('#status.ok:has-text("Expo et balance auto")', { timeout: 8000 });
    await page.click('.action:has-text("Prendre la référence")');
    await page.waitForSelector('.fix-ref img', { timeout: 5000 });
    await page.click('.action:has-text("Raccorder la sélection")');
    await page.waitForSelector('#status.ok:has-text("Raccord posé")', { timeout: 8000 });
    await page.waitForSelector('.fix-preview canvas', { timeout: 3000 });
    await page.click('.lr-head:has-text("Expo, balance et raccord")');
  });
  await step('enchaînement d\'effets', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('.chips .action:text-is("Tout")');
    await page.selectOption('.section:has-text("Placement") .row:has-text("Position") select', 'markers');
    await page.selectOption('.section:has-text("Placement") .row:has-text("Entre les coupes") select', 'chain');
    for (const n of ['Zoom in', 'Flash blanc', 'Shake']) await page.click('#grid .card:has-text("' + n + '")', { modifiers: ['Shift'] });
    if ((await page.locator('.chain-chip').count()) !== 3) throw new Error('3 effets attendus dans l\'enchaînement');
    if (!/enchaînement · 3 effets/.test(await page.textContent('#cta'))) throw new Error('bouton : ' + await page.textContent('#cta'));
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("Enchaînement appliqué")', { timeout: 8000 });
    const log = await page.evaluate(() => window.RRFXApp.S.logLines.map(l => l.message).join('\n'));
    if (!/Enchaînement : /.test(log)) throw new Error('journal : ' + log.slice(-300));
    await page.click('.chain-chip:has-text("Shake")');
    await page.selectOption('.section:has-text("Placement") .row:has-text("Entre les coupes") select', 'seed');
    await page.selectOption('.section:has-text("Placement") .row:has-text("Position") select', 'cut');
  });
  await step('packs de style', async () => {
    await page.click('.tab[data-tab=mine]');
    await page.click('.mine-switch .action:has-text("Ma bibliothèque")').catch(() => {});
    await page.click('.action:text-is("Créer un pack…")');
    await page.fill('.modal input.textfield', 'Style été');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal .cta')]);
    await page.waitForSelector('#status.ok:has-text("Style été")', { timeout: 5000 });
    const file = path.join(tmp, 'Style ete.rrfxpack');
    fs.copyFileSync(await dl.path(), file);
    const before = await page.evaluate(() => window.RRFXApp.S.lib.items.length);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action:text-is("Importer un pack…")')]);
    await chooser.setFiles(file);
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("importé")', { timeout: 5000 });
    const after = await page.evaluate(() => window.RRFXApp.S.lib.items.length);
    if (after <= before) throw new Error('rien d\'ajouté (' + before + ' → ' + after + ')');
  });
  await step('intensité selon le volume', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('.chips .action:text-is("Tout")');
    await page.click('.card:has-text("Zoom rotation")');
    await page.click('.section:has-text("Placement") label:has-text("suit le volume")');
    await page.click('#cta');
    await page.waitForSelector('#status.ok, #status.warn', { timeout: 8000 });
    const log = await page.evaluate(() => window.RRFXApp.S.logLines.map(l => l.message).join('\n'));
    if (!/Intensité selon le volume/.test(log)) throw new Error('le volume n\'a pas été lu');
  });
  await step('textes', async () => {
    await page.click('.tab[data-tab=titles]');
    await page.fill('textarea.lyrics', 'Premier\nDeuxième\nTroisième');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("texte")', { timeout: 8000 });
    await snap('8-textes');
  });
  await step('style de texte et Mes couleurs', async () => {
    await page.click('.tab[data-tab=titles]');
    await page.click('.section:has-text("Style du texte") .action:text-is("Créer un style…")');
    await page.waitForSelector('.style-preview');
    await page.click('.section:has-text("Style du texte") .action:text-is("Enregistrer comme style…")');
    await page.fill('.modal input', 'Jaune gras');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("Jaune gras")', { timeout: 3000 });
    const sel = await page.locator('.section:has-text("Style du texte") select >> nth=0').inputValue();
    if (!/^u:/.test(sel)) throw new Error('style enregistré non choisi : ' + sel);
    await page.click('.section:has-text("Mes couleurs") .action:text-is("Coller des codes…")');
    await page.fill('.modal textarea', 'https://coolors.co/palette/264653-2a9d8f-e9c46a');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("3 couleurs ajoutées")', { timeout: 3000 });
    if ((await page.locator('.section:has-text("Mes couleurs") .key-color').count()) !== 3) throw new Error('pastilles de Mes couleurs');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("texte"), #status.warn:has-text("texte")', { timeout: 8000 });
    await snap('8b-style-texte');
  });
  await step('rampes prédéfinies par usage', async () => {
    await page.click('.tab[data-tab=ramp]');
    const groups = await page.locator('.ramp-groups .chips-group').allTextContents();
    if (groups.length < 4) throw new Error('groupes : ' + groups.join(', '));
    await page.click('.ramp-groups .action:has-text("Coup de fouet vers la coupe")');
    await page.waitForSelector('.ramp-groups .action.selected:has-text("Coup de fouet vers la coupe")', { timeout: 2000 });
    await page.click('#cta');
    await page.click('.modal .cta').catch(() => {});
    await page.waitForSelector('#status.ok', { timeout: 5000 });
  });
  await step('Mes LUTs et dégradé', async () => {
    await page.click('.tab[data-tab=color]');
    await page.waitForSelector('.lut-card', { timeout: 5000 });
    await page.click('.lut-card >> nth=1');
    await page.waitForSelector('.lut-card.on >> nth=0');
    await page.click('.lr-panel:has-text("Mes LUTs") .action.go:text-is("Appliquer")');
    await page.waitForSelector('#status.warn:has-text("LUT d\'exemple")', { timeout: 5000 });
    await snap('9b-mes-luts');
    const g = '.lr-panel:has(.lr-title:text-is("Dégradés de couleur"))';
    // Fermé à la première ouverture : le sommaire l'ouvre et l'amène en vue.
    await page.click('.view.on .sec-nav .action:text-is("Dégradés")');
    await page.waitForSelector(g + ':not(.closed)', { timeout: 2000 });
    await page.click(g + ' .action:text-is("Coller du CSS…")');
    await page.fill('.modal textarea', 'linear-gradient(to right, #ff7e5f, #feb47b)');
    await page.click('.modal .cta');
    await page.click(g + ' .action:text-is("Appliquer le dégradé")');
    await page.waitForSelector('#status.ok:has-text("Dégradé posé"), #status.warn:has-text("Dégradé posé")', { timeout: 5000 });
    await page.click(g + ' .action:text-is("Enregistrer…")');
    await page.fill('.modal input', 'Coucher de soleil');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("Coucher de soleil")', { timeout: 3000 });
    await snap('9c-degrade');
  });
  await step('import depuis un lien', async () => {
    await page.click('.tab[data-tab=assets]');
    const f = '.section:has-text("Importer depuis un lien")';
    await page.fill(f + ' input[aria-label="Lien à importer"]', 'https://www.youtube.com/watch?v=abc123');
    await page.waitForSelector(f + ' .note:has-text("yt-dlp")', { timeout: 2000 });
    await page.fill(f + ' input[aria-label="Lien à importer"]', 'https://www.dropbox.com/s/x/son.mp3?dl=0');
    await page.waitForSelector(f + ' .note:has-text("Lien direct")', { timeout: 2000 });
    await page.click(f + ' .action:text-is("Importer dans la timeline")');
    await page.waitForSelector('#status.warn:has-text("Disponible dans Premiere")', { timeout: 5000 });
  });
  await step('Importer… dans Mes effets (presets, nuancier)', async () => {
    const json = path.join(tmp, 'presets.json'), ase = path.join(tmp, 'Marque.ase');
    fs.writeFileSync(json, JSON.stringify({ rrfx: 1, items: [{ type: 'textStyle', name: 'Style reçu', data: { style: { fill: '#00ff88', shadow: true } } }, { type: 'gradient', name: 'Dégradé reçu', data: { g: { type: 'linear', angle: 45, colors: ['#000000', '#ff0000'] } } }, { type: 'nope', name: 'x', data: {} }] }));
    fs.writeFileSync(ase, Buffer.from(require('../plugin/js/couleurs.js').writeASE([{ name: 'Rouge', hex: '#e63946' }, { hex: '#1d3557' }])));
    await page.click('.tab[data-tab=mine]');
    await page.click('.mine-switch .action:has-text("Ma bibliothèque")').catch(() => {});
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action.go:text-is("Importer…")')]);
    await chooser.setFiles([json, ase]);
    await page.waitForSelector('#status.ok:has-text("Importé")', { timeout: 5000 });
    const t = await page.textContent('#status-detail').catch(() => '');
    if (!/2 éléments/.test(t) || !/2 couleurs|2 éléments dans Mes couleurs/.test(t)) throw new Error('détail : ' + t);
    await page.waitForSelector('.list-item:has-text("Style reçu")', { timeout: 2000 });
    await page.click('.list-item:has-text("Dégradé reçu") .action:text-is("Ouvrir")');
    await page.waitForSelector('.tab.on[data-tab=color]', { timeout: 3000 });
  });
  await step('clip express', async () => {
    await page.click('.tab[data-tab=express]');
    await page.waitForSelector('.xp-check');
    await page.waitForTimeout(600);
    await page.click('.xp-style:has-text("Chill")');
    await page.waitForTimeout(200);
    if (!/Chill/.test(await page.textContent('#cta'))) throw new Error('style non choisi');
    await page.click('#cta');
    await page.waitForFunction(() => /prêt|revoir/.test(document.getElementById('status-title').textContent), null, { timeout: 60000 });
    const t = await page.textContent('#status-title');
    if (!/Ton montage est prêt · Chill/.test(t)) throw new Error('express : ' + t + ' / ' + await page.textContent('#status-detail'));
    const kept = await page.evaluate(() => window.RRFXApp.settings().vary);
    if (kept === 'chain') throw new Error('réglages de l\'onglet Effets non rendus');
  });
  await step('Mes effets : recherche et filtres', async () => {
    await page.click('.tab[data-tab=mine]');
    await page.waitForSelector('.mine-chips .action', { timeout: 2000 });
    await page.click('.mine-chips .action:has-text("Style de texte")');
    const metas = await page.locator('#mine-list .li-meta').allTextContents();
    if (!metas.length || metas.some(m => !/^Style de texte/.test(m))) throw new Error('filtre : ' + metas.join(' | '));
    await page.click('.mine-chips .action:has-text("Tout")');
    await page.fill('#mine-filter input', 'reçu');
    const names = await page.locator('#mine-list .li-name').allTextContents();
    if (names.join() !== 'Dégradé reçu,Style reçu' && names.join() !== 'Style reçu,Dégradé reçu') throw new Error('recherche : ' + names.join(' | '));
    await page.fill('#mine-filter input', '');
  });
  await step('couleur : sommaire', async () => {
    await page.click('.tab[data-tab=color]');
    await page.click('.view.on .sec-nav .action:text-is("Mes LUTs")');
    const top = await page.evaluate(() => { const el = document.querySelector('.view.on [data-panel=luts]'), sc = document.getElementById('scroll'); return el.getBoundingClientRect().top - sc.getBoundingClientRect().top; });
    if (top < 0 || top > 80) throw new Error('panneau Mes LUTs à ' + top + ' px du haut');
  });
  await step('express : enregistrer ce style', async () => {
    await page.click('.tab[data-tab=express]');
    await page.click('.action:text-is("Enregistrer ce style…")');
    await page.fill('.modal input', 'Mon chill');
    await page.click('.modal .cta');
    await page.waitForSelector('.xp-style.on:has-text("Mon chill")', { timeout: 3000 });
  });
  await step('montage express YouTube (sans musique)', async () => {
    await page.click('.xp-style:has-text("YouTube face cam")');
    await page.waitForSelector('.xp-step:has-text("Couper les silences")');
    if (!/YouTube face cam/.test(await page.textContent('#cta'))) throw new Error('style non choisi');
    await page.click('#cta');
    await page.waitForFunction(() => /YouTube face cam|revoir|possible/.test(document.getElementById('status-title').textContent), null, { timeout: 90000 });
    const t = await page.textContent('#status-title'), rep = await page.textContent('.section:has-text("Dernier montage express")');
    if (!/Ton montage est prêt/.test(t)) throw new Error('express : ' + t + ' / ' + rep);
    if (!/Couper les silences · \d+ silences coupés/.test(rep) || !/Zoom visage/.test(rep)) throw new Error('rapport : ' + rep);
  });
  await step('parole : silences, sous-titres, bandeau', async () => {
    await page.click('.tab[data-tab=speech]');
    await page.click('button:has-text("Analyser")');
    await page.waitForSelector('#status.ok:has-text("silences trouvés")', { timeout: 10000 });
    if (await page.locator('.sp-gap').count() < 3) throw new Error('silences non affichés');
    await snap('parole');
    await page.click('.section:has-text("Couper les silences") button.go:has-text("Couper les silences")');
    await page.waitForSelector('#status:has-text("silences coupés")', { timeout: 10000 });
    await page.click('button:has-text("Zoomer sur le visage")');
    await page.waitForSelector('#status:has-text("Zoom visage appliqué")', { timeout: 15000 });
    if (!/Visage suivi dans 0 plan/.test(await page.textContent('#status-detail'))) throw new Error('suivi : ' + await page.textContent('#status-detail'));
    await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:03,000\nBonjour à tous et bienvenue\n\n2\n00:00:04,000 --> 00:00:05,000\nMerci');
    await page.click('.section:has(textarea.lyrics) .action:has-text("Mot par mot")');
    if (!/2 sous-titres lus → 6 textes/.test(await page.textContent(".section:has(textarea.lyrics)"))) throw new Error('sous-titres non lus');
    await page.click('button:has-text("Poser les sous-titres")');
    await page.waitForSelector('#status:has-text("sous-titres posés")', { timeout: 10000 });
    await page.fill('.section:has-text("Bandeau") input >> nth=0', 'Camille Martin');
    await page.click('button:has-text("Poser le bandeau")');
    await page.waitForSelector('#status.ok:has-text("Bandeau posé")', { timeout: 10000 });
  });
  await step('parole : euh, voix, musique, chapitres, mots clés', async () => {
    await page.click('.tab[data-tab=speech]');
    const idle = () => page.waitForFunction(() => !window.RRFXApp.S.busy, null, { timeout: 20000 });
    await page.click('button:has-text("Couper les « euh »")');
    await page.waitForTimeout(100);
    await idle();
    if (!/euh/.test(await page.textContent('#status-title'))) throw new Error('euh : ' + await page.textContent('#status-title'));
    await page.click('button:has-text("Égaliser la voix")');
    await page.waitForSelector('#status.ok:has-text("-14 LUFS")', { timeout: 10000 });
    if (!/Égaliser la voix/.test(await page.textContent('#cta'))) throw new Error('le bouton du haut ne suit pas le dernier outil');
    await page.click('.sec-nav .action:has-text("Chapitres")');
    await page.waitForTimeout(200);
    // La section (la dernière de l'onglet) est visible sous le sommaire.
    const seen = await page.evaluate(() => { const t = document.querySelector('[data-sec="chapitres"] .section-title').getBoundingClientRect(), sc = document.getElementById('scroll').getBoundingClientRect(), nav = document.querySelector('.sec-nav').getBoundingClientRect(); return t.top >= nav.bottom - 1 && t.bottom <= sc.bottom; });
    if (!seen) throw new Error('sommaire : la section Chapitres n\'est pas à l\'écran');
    await page.click('.sec-nav .action:has-text("Euh")');
    await page.waitForTimeout(200);
    const top = await page.evaluate(() => document.querySelector('[data-sec="euh"]').getBoundingClientRect().top - document.querySelector('.sec-nav').getBoundingClientRect().bottom);
    if (top < 0 || top > 20) throw new Error('sommaire : section Euh à ' + top + ' px sous le sommaire');
    await page.click('button:has-text("Baisser la musique sous la voix")');
    await page.waitForSelector('#status.ok:has-text("Musique baissée")', { timeout: 10000 });
    await page.click('.section:has-text("Chapitres YouTube") .action:has-text("Les sous-titres")');
    await page.click('button:has-text("Créer les chapitres")');
    await page.waitForSelector('.section:has-text("Chapitres YouTube") textarea', { timeout: 10000 });
    if (!/^00:00 /.test(await page.inputValue('.section:has-text("Chapitres YouTube") textarea'))) throw new Error('chapitres');
    await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:04,000\nGagne 500 euros en 3 minutes !');
    await page.click('button:has-text("Poser les sous-titres")');
    await page.waitForSelector('#status:has-text("mots clés mis en avant")', { timeout: 15000 });
    if (!/3 mots clés|2 mots clés/.test(await page.textContent('#status-detail'))) throw new Error('mots clés : ' + await page.textContent('#status-detail'));
  });
  await step('zoom suivi (objet) et 9:16 qui suit le visage', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('#grid .card:has-text("Zoom suivi")');
    await page.click('#cta');
    await page.waitForSelector('.modal:has-text("Entoure l\'objet")', { timeout: 15000 });
    const box = await page.locator('.trk-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7);
    await page.mouse.up();
    await page.click('.modal .cta');
    await page.waitForSelector('#status:has-text("Zoom suivi (objet) appliqué")', { timeout: 15000 });
    if (!/Objet suivi dans 1 plan/.test(await page.textContent('#status-detail'))) throw new Error('objet : ' + await page.textContent('#status-detail'));
    await page.click('.tab[data-tab=formats]');
    await page.click('.section:has-text("Cadrage") .action:has-text("Suivre le visage")');
    await page.click('#cta');
    await page.waitForSelector('#status:has-text("créée")', { timeout: 20000 });
    await page.click('.section:has-text("Cadrage") .action:has-text("Recadrage auto")');
  });
  await step('recherche rapide', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.pal-input');
    await page.fill('.pal-input', 'zoom rot');
    await page.waitForSelector('.pal-item.on:has-text("Zoom rotation")');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.tab.on[data-tab=effects]');
    if (!/Zoom rotation/.test(await page.textContent('#cta'))) throw new Error('effet non ouvert : ' + await page.textContent('#cta'));
    await page.keyboard.press('Control+k');
    await page.fill('.pal-input', 'look nuit');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.tab.on[data-tab=color]');
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    if (await page.isVisible('.pal-input')) throw new Error('Échap ne ferme pas');
  });
  await step('accueil et test de compatibilité', async () => {
    await page.evaluate(() => window.RRFXApp.services.welcome());
    await page.waitForSelector('.modal:has-text("Bienvenue dans RR FX")');
    await page.click('.modal .button-secondary:has-text("Tester mon Premiere")');
    await page.waitForSelector('#status.ok:has-text("Tout fonctionne")', { timeout: 8000 });
    await page.waitForSelector('.section:has-text("Test de compatibilité") .xp-check.ok');
  });
  await step('partage', async () => {
    await page.click('.tab[data-tab=mine]');
    await page.hover(".list-item >> nth=0");
    await page.click(".list-item .action[title^=\"Partager\"] >> nth=0");
    const code = await page.inputValue('.modal textarea');
    if (!/^RRFX[01]:/.test(code)) throw new Error('code de partage invalide');
    await page.click('.modal .cta');
    const before = await page.locator('.list-item').count();
    await page.click('.action:has-text("Coller un code")');
    await page.fill('.modal textarea', code);
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("ajouté")', { timeout: 3000 }).catch(async e => { throw new Error(e.message.split('\n')[0] + ' · ' + (await page.textContent('#status')).replace(/\s+/g, ' ').slice(0, 200)); });
    if ((await page.locator('.list-item').count()) !== before + 1) throw new Error('l\'effet partagé n\'a pas été ajouté');
  });
  await step('bibliothèque en ligne', async () => {
    await page.click('.tab[data-tab=mine]');
    await page.click('.mine-switch .action:has-text("Communauté")');
    await page.waitForSelector('.comm-item', { timeout: 5000 });
    const names = await page.$$eval('.comm-item .li-name', els => els.map(e => e.textContent));
    if (names.join() !== 'Zoom drop,Rampe douce') throw new Error('ordre inattendu : ' + names.join());
    await page.click('.comm-item:has-text("Zoom drop") .action:has-text("Ajouter")');
    await page.waitForSelector('#status.ok:has-text("Ajouté")', { timeout: 3000 });
    await page.waitForSelector('.comm-item:has-text("Zoom drop") .action:has-text("Ouvrir")', { timeout: 3000 });
    await snap('9-communaute');
    await page.click('.mine-switch .action:has-text("Ma bibliothèque")');
    await page.waitForSelector('.list-item:has-text("Zoom drop")', { timeout: 3000 });
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 5000 }),
      (async () => {
        await page.hover('.list-item:has-text("Zoom drop")');
        await page.click('.list-item:has-text("Zoom drop") .action[title^="Publier"]');
        await page.fill('.modal textarea', 'Mon test');
        await page.click('.modal .cta');
      })()
    ]);
    const u = new URL(popup.url());
    if (u.searchParams.get('template') !== 'preset.yml' || !/^RRFX[01]:/.test(u.searchParams.get('code') || '')) throw new Error('formulaire mal rempli : ' + popup.url());
    await popup.close();
    await page.waitForSelector('#status.ok:has-text("Formulaire ouvert")', { timeout: 3000 });
  });
  await step('tout effacer', async () => {
    await page.click('.tab[data-tab=settings]');
    await page.click('.action:has-text("Tout effacer")');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("nettoyée")', { timeout: 5000 });
  });
  await step('réglages + raccourci', async () => {
    await page.click('.tab[data-tab=settings]');
    await page.click('[data-shortcut=apply]');
    await page.keyboard.press('KeyZ');
    if ((await page.textContent('[data-shortcut=apply]')) !== 'Z') throw new Error('raccourci non changé');
    await snap('5-reglages');
  });
  await step('mode réduit', async () => {
    await page.click('#toggle-compact');
    if (!(await page.isHidden('#scroll'))) throw new Error('le contenu devrait être masqué');
    await page.click('#toggle-compact');
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) {
    console.error('Échecs :\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('Interface OK');
})();
