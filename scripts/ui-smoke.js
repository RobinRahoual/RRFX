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
  // Onglet : un clic sur son groupe (Montage, Bibliothèque) puis sur le sous-onglet, comme à la main.
  const goTab = async (t, p) => {
    p = p || page;
    const g = await p.evaluate(x => { const gr = window.RRFXLayout.groupOf(x); return gr && gr.tabs.length > 1 ? gr.id : ''; }, t);
    if (g && !(await p.isVisible('#subtabs .tab[data-tab=' + t + ']'))) await p.click('.tab-group[data-group=' + g + ']');
    if (await p.isVisible('.tab[data-tab=' + t + ']')) await p.click('.tab[data-tab=' + t + ']');
  };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const snap = async name => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const step = async (label, fn) => {
    try { await fn(); } catch (e) {
      errors.push(label + ' : ' + e.message.split('\n')[0] + ' [état : ' + (await page.textContent('#status').catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160) + ']');
      // Une fenêtre restée ouverte ne doit pas bloquer les étapes suivantes.
      await page.keyboard.press('Escape').catch(() => {});
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
  // Traduction : MyMemory remplacé par une réponse locale (« EN: » devant le texte).
  await page.route('https://api.mymemory.translated.net/**', route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'EN: ' + q } }) });
  });
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
  await goTab('effects');
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
    await goTab('ramp');
    const c = await page.locator('.ramp-canvas').boundingBox();
    await page.mouse.dblclick(c.x + c.width * 0.3, c.y + c.height * 0.8);
    await page.click('#cta');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok', { timeout: 5000 });
    await snap('3-rampe');
  });
  await step('capture', async () => {
    await goTab('mine');
    await page.click('#cta');
    await page.waitForSelector('.list-item', { timeout: 3000 });
    await snap('4-mes-effets');
  });
  await step('overlay', async () => {
    await goTab('effects');
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
    await goTab('music');
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
    await goTab('effects');
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
    await goTab('assets');
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
    await goTab('effects');
    await page.click('.chips .action:text-is("Tout")');
    await page.click('.card:has-text("Flash blanc")');
    await page.selectOption('.section:has-text("Placement") select >> nth=0', 'beats');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("zones"), #status.warn:has-text("zones")', { timeout: 10000 });
    await page.selectOption('.section:has-text("Placement") select >> nth=0', 'markers');
  });
  await step('rampe calée sur le tempo', async () => {
    await goTab('ramp');
    await page.click('.row:has-text("Sur le tempo") .action:text-is("1 temps")');
    await page.waitForSelector('#status.ok:has-text("Rampe de")', { timeout: 5000 });
    const t = await page.textContent('#status-title');
    if (!/Rampe de 1[23] images/.test(t)) throw new Error('1 temps à 120 BPM, 25 i/s ≈ 12,5 images : ' + t);
  });
  await step('couleur', async () => {
    await goTab('color');
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
    await goTab('mine');
    await page.click('.list-item:has-text("Nuit perso") .action:text-is("Ouvrir")');
    await page.waitForSelector('.tab.on[data-tab=color]', { timeout: 3000 });
  });
  await step('conversion log', async () => {
    await goTab('color');
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
    await goTab('color');
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
    await goTab('effects');
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
    await goTab('mine');
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
    await goTab('effects');
    await page.click('.chips .action:text-is("Tout")');
    await page.click('.card:has-text("Zoom rotation")');
    await page.click('.section:has-text("Placement") label:has-text("suit le volume")');
    await page.click('#cta');
    await page.waitForSelector('#status.ok, #status.warn', { timeout: 8000 });
    const log = await page.evaluate(() => window.RRFXApp.S.logLines.map(l => l.message).join('\n'));
    if (!/Intensité selon le volume/.test(log)) throw new Error('le volume n\'a pas été lu');
  });
  await step('textes', async () => {
    await goTab('titles');
    await page.fill('textarea.lyrics', 'Premier\nDeuxième\nTroisième');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("texte")', { timeout: 8000 });
    await snap('8-textes');
  });
  await step('style de texte et Mes couleurs', async () => {
    await goTab('titles');
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
    await goTab('ramp');
    const groups = await page.locator('.ramp-groups .chips-group').allTextContents();
    if (groups.length < 4) throw new Error('groupes : ' + groups.join(', '));
    await page.click('.ramp-groups .action:has-text("Coup de fouet vers la coupe")');
    await page.waitForSelector('.ramp-groups .action.selected:has-text("Coup de fouet vers la coupe")', { timeout: 2000 });
    await page.click('#cta');
    await page.click('.modal .cta').catch(() => {});
    await page.waitForSelector('#status.ok', { timeout: 5000 });
  });
  await step('Mes LUTs et dégradé', async () => {
    await goTab('color');
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
    await goTab('assets');
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
    await goTab('mine');
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
    await goTab('express');
    await page.waitForSelector('.xp-check');
    await page.waitForTimeout(600);
    if ((await page.locator('.xp-style').count()) > 8) throw new Error('les styles devraient être repliés');
    await page.click('.xp-more:has-text("Tous les styles")');
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
    await goTab('mine');
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
    await goTab('color');
    await page.click('.view.on .sec-nav .action:text-is("Mes LUTs")');
    const top = await page.evaluate(() => { const el = document.querySelector('.view.on [data-panel=luts]'), sc = document.getElementById('scroll'); return el.getBoundingClientRect().top - sc.getBoundingClientRect().top; });
    if (top < 0 || top > 80) throw new Error('panneau Mes LUTs à ' + top + ' px du haut');
  });
  await step('express : enregistrer ce style', async () => {
    await goTab('express');
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
    await goTab('speech');
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
    await goTab('speech');
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
    await goTab('effects');
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
    await goTab('formats');
    await page.click('.section:has-text("Cadrage") .action:has-text("Suivre le visage")');
    await page.click('#cta');
    await page.waitForSelector('#status:has-text("créée")', { timeout: 20000 });
    await page.click('.section:has-text("Cadrage") .action:has-text("Recadrage auto")');
  });
  const idle = () => page.waitForFunction(() => !window.RRFXApp.S.busy, null, { timeout: 30000 });
  await step('musique : risers et réverb de fin', async () => {
    await goTab('music');
    await page.click('.section:has-text("Risers avant les drops") .action:text-is("Trouver les drops")');
    await page.waitForSelector('#status:has-text("drop")', { timeout: 10000 });
    await idle();
    await page.click('.section:has-text("Risers avant les drops") .action.go');
    await page.waitForSelector('#status.ok:has-text("riser"), #status.warn:has-text("Aucun drop")', { timeout: 10000 });
    await idle();
    await page.click('.section:has-text("Réverb de fin") .action.go');
    await page.waitForSelector('#status.ok:has-text("Réverb de fin posée")', { timeout: 15000 });
    await idle();
  });
  await step('parole : respirations, traduction, plans de coupe', async () => {
    await goTab('speech');
    await page.click('.view.on .sec-nav .action:text-is("Souffle")');
    await page.click('.section:has-text("Respirations et clics") .action.go');
    await page.waitForSelector('#status.ok:has-text("baissé"), #status.warn:has-text("Rien à baisser")', { timeout: 15000 });
    await idle();
    if (!/Atténuer respirations et clics/.test(await page.textContent('#cta'))) throw new Error('le bouton du haut devrait reprendre l\'outil : ' + await page.textContent('#cta'));
    await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:03,000\nRegarde ce logo tout neuf\n\n2\n00:00:09,000 --> 00:00:11,000\nEt cette lumière orange\n');
    await page.click('.view.on .sec-nav .action:text-is("Traduire")');
    await page.click('.section:has-text("Traduire les sous-titres") .action.go');
    await page.waitForSelector('#status.ok:has-text("traduits en anglais")', { timeout: 10000 });
    await idle();
    const srt = await page.evaluate(() => window.RRFXApp.speech.settings().srt);
    if (!/EN: Regarde ce logo tout neuf/.test(srt) || !/00:00:09,000 --> 00:00:11,000/.test(srt)) throw new Error('srt traduit : ' + srt);
    await page.click('.section:has-text("Traduire les sous-titres") .action:text-is("Revenir à l\'original")');
    await page.waitForFunction(() => /^1\n00:00:01,000 --> 00:00:03,000\nRegarde/.test(window.RRFXApp.speech.settings().srt));
    await page.click('.view.on .sec-nav .action:text-is("Plans de coupe")');
    await page.click('.section:has-text("Plans de coupe sur les mots clés") .action:text-is("Voir les correspondances")');
    const note = await page.textContent('.section:has-text("Plans de coupe sur les mots clés")');
    if (!/« logo » → Logo RR/.test(note) || !/« orange » → Light leak orange/.test(note)) throw new Error('correspondances : ' + note.slice(-300));
    await page.click('.section:has-text("Plans de coupe sur les mots clés") .action.go');
    await page.waitForSelector('#status.ok:has-text("2 plans de coupe posés")', { timeout: 10000 });
    await idle();
  });
  await step('formats : vérifier, extraits, lot, modèles', async () => {
    await page.evaluate(() => { window.RRFXApp.settings().formatsPlus.pfImage = false; });
    await goTab('formats');
    await page.click('.view.on .sec-nav .action:text-is("Vérifier")');
    await page.click('.section:has-text("Vérifier avant export") .action.go');
    await page.waitForSelector('#status.error:has-text("2 problèmes et 2 remarques")', { timeout: 10000 });
    if ((await page.locator('.pf-item').count()) !== 4) throw new Error('4 lignes attendues');
    await page.click('.pf-item >> nth=0');
    await idle();
    await snap('formats-verif');
    // La vidéo de démo dure 18 s : extraits de 5 à 12 s.
    await page.evaluate(() => { const f = window.RRFXApp.settings().formatsPlus; f.min = 5; f.max = 12; f.count = 2; });
    await goTab('formats');
    await page.click('.view.on .sec-nav .action:text-is("Extraits")');
    await page.click('.section:has-text("Extraits pour les réseaux") .action:text-is("Trouver les passages")');
    await page.waitForSelector('#status.ok:has-text("extrait")', { timeout: 15000 });
    await idle();
    const n = await page.locator('.ex-item').count();
    if (n < 1) throw new Error('aucun extrait affiché');
    await page.click('.section:has-text("Extraits pour les réseaux") .action:text-is("Créer les extraits")');
    await page.waitForSelector('#status.ok:has-text("créé")', { timeout: 30000 });
    await idle();
    const log = await page.evaluate(() => window.RRFXApp.S.logLines.map(l => l.message).join('\n'));
    if (!/Extrait 1/.test(await page.textContent('#status-detail') + log)) throw new Error('extrait : ' + await page.textContent('#status-detail'));
    // Plusieurs séquences : la même action sur chacune (ici la vérification).
    await page.click('.view.on .sec-nav .action:text-is("Export")');
    await page.evaluate(() => { const t = document.querySelector('[data-sec=export] .section-title'); if (t && t.closest('.section').classList.contains('folded')) t.click(); });
    await page.selectOption('[data-sec=export] select >> nth=0', 'preflight');
    await page.click('[data-sec=export] .action:text-is("Lister les séquences")');
    await page.waitForSelector('[data-sec=export] .seq-list label', { timeout: 5000 });
    await page.click('[data-sec=export] .seq-list label >> nth=1');
    await page.click('[data-sec=export] .action.go');
    await page.waitForSelector('#status.ok:has-text("1 séquence")', { timeout: 15000 });
    await idle();
    await page.click('.view.on .sec-nav .action:text-is("Modèles")');
    await page.click('.tpl-card:has-text("Reels / TikTok")');
    await page.click('.section:has-text("Nouveau projet depuis un modèle") .action.go');
    await page.waitForSelector('#status.ok:has-text("créée")', { timeout: 10000 });
    await idle();
    const s = await page.evaluate(() => [window.RRFXApp.settings().express.recipe, window.RRFXApp.formats.settings().id]);
    if (s.join() !== 'reels,9x16') throw new Error('réglages du modèle : ' + s);
    await page.click('.section:has-text("Nouveau projet depuis un modèle") .action:has-text("Enregistrer mes réglages")');
    await page.fill('.modal input', 'Mon modèle shorts');
    await page.click('.modal .cta');
    await page.waitForSelector('.tpl-card.on:has-text("Mon modèle shorts")', { timeout: 3000 });
  });
  await step('textes : barre de progression et compte à rebours', async () => {
    await goTab('titles');
    await page.click('.section:has-text("Barre de progression et compte à rebours") .action:text-is("Poser la barre")');
    await page.waitForSelector('#status.ok:has-text("Barre de progression posée")', { timeout: 10000 });
    await idle();
    await page.click('.section:has-text("Barre de progression et compte à rebours") .action:text-is("Poser le compte à rebours")');
    await page.waitForSelector('#status.ok:has-text("Compte à rebours 3")', { timeout: 10000 });
    await idle();
  });
  await step('historique détaillé', async () => {
    await page.click('#history');
    await page.waitForSelector('.hist-item', { timeout: 3000 });
    const n = await page.locator('.hist-item').count();
    if (n < 3) throw new Error(n + ' opérations');
    await page.locator('.hist-item').nth(2).locator('.action:text-is("Jusqu\'ici")').click();
    await page.click('.modal .cta');
    await page.waitForSelector('#status:has-text("Annulation terminée")', { timeout: 10000 });
    await idle();
    if ((await page.evaluate(() => window.RRFXApp.S.lib.history.length)) !== n - 3) throw new Error('3 opérations annulées attendues');
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
    // Les outils sans onglet à eux sont amenés en vue (et ouverts).
    await page.keyboard.press('Control+k');
    await page.fill('.pal-input', 'dégradé de couleur');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.view.on [data-panel=gradient]:not(.closed)', { timeout: 2000 });
    await page.keyboard.press('Control+k');
    await page.fill('.pal-input', 'depuis un lien');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('link-input'), null, { timeout: 2000 });
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
    await goTab('mine');
    await page.hover("#mine-list .list-item >> nth=0");
    await page.click("#mine-list .list-item .action[title^=\"Partager\"] >> nth=0");
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
    await goTab('mine');
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
        await page.hover('#mine-list .list-item:has-text("Zoom drop")');
        await page.click('#mine-list .list-item:has-text("Zoom drop") .action[title^="Publier"]');
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
    await goTab('settings');
    await page.click('.action:has-text("Tout effacer")');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("nettoyée")', { timeout: 5000 });
  });
  await step('réglages + raccourci', async () => {
    await goTab('settings');
    await page.click('.section-title:has-text("Raccourcis clavier")');
    await page.click('[data-shortcut=apply]');
    await page.keyboard.press('KeyZ');
    if ((await page.textContent('[data-shortcut=apply]')) !== 'Z') throw new Error('raccourci non changé');
    // Maj + touche, pour une action qui n'avait pas de raccourci.
    await page.click('[data-shortcut=preflight]');
    await page.keyboard.press('Shift+KeyV');
    if ((await page.textContent('[data-shortcut=preflight]')) !== 'Maj+V') throw new Error('Maj+V non pris : ' + await page.textContent('[data-shortcut=preflight]'));
    await page.click('#scroll');
    await page.keyboard.press('Shift+KeyV');
    await page.waitForSelector('#status:has-text("Vérification avant export"), #status.error, #status.warn', { timeout: 5000 });
    // Télécommande et synchro : sections présentes (désactivées par défaut).
    await page.waitForSelector('.section-title:has-text("Télécommande")');
    await page.waitForSelector('.section-title:has-text("Synchro entre ordinateurs")');
    await snap('5-reglages');
  });
  await step('2.5 : montage par le texte', async () => {
    await goTab('speech');
    await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:03,000\nBonjour à tous\n\n2\n00:00:03,400 --> 00:00:05,000\neuh je recommence\n\n3\n00:00:05,200 --> 00:00:08,000\nAujourd\'hui on parle café\n');
    await page.click('.view.on .sec-nav .action:text-is("Texte")');
    await page.waitForSelector('.tx-row >> nth=2');
    await page.fill('.section:has-text("Montage par le texte") input[type=search]', 'cafe');
    if ((await page.locator('.tx-row').count()) !== 1) throw new Error('recherche : 1 phrase attendue');
    await page.fill('.section:has-text("Montage par le texte") input[type=search]', '');
    await page.locator('.tx-row').nth(1).locator('.tx-cut').click();
    await page.waitForSelector('.tx-row.cut');
    await page.click('.section:has-text("Montage par le texte") .action.go');
    await page.waitForSelector('#status.ok:has-text("1 phrase coupée")', { timeout: 10000 });
    await idle();
    const srt = await page.evaluate(() => window.RRFXApp.speech.settings().srt);
    if (/recommence/.test(srt) || !/^1\n00:00:01,000 --> 00:00:03,000/.test(srt) || !/00:00:03,\d{3} --> 00:00:06,\d{3}\nAujourd/.test(srt)) throw new Error('srt recalé : ' + srt);
    // Prises ratées barrées d'office.
    await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:02,500\nAujourd\'hui on va parler\n\n2\n00:00:02,800 --> 00:00:05,000\nAujourd\'hui on va parler du café\n\n3\n00:00:05,200 --> 00:00:06,000\neuh attends je recommence\n\n4\n00:00:06,300 --> 00:00:08,000\nLa terrasse est ouverte\n');
    await page.waitForFunction(() => document.querySelectorAll('.tx-row').length === 4, null, { timeout: 3000 });
    await page.click('.section:has-text("Montage par le texte") .action:text-is("Barrer les prises ratées")');
    await page.waitForSelector('#status:has-text("2 prises ratées barrées")', { timeout: 3000 });
    if ((await page.locator('.tx-row.cut').count()) !== 2) throw new Error('2 phrases barrées attendues');
  });
  await step('2.5 : musique à la durée, versions', async () => {
    await goTab('music');
    await page.click('.section:has-text("Musique à la durée de la vidéo") .action:text-is("Comparer les durées")');
    await page.waitForSelector('.section:has-text("Musique à la durée de la vidéo") .note:has-text("à retirer")', { timeout: 5000 });
    await page.click('.section:has-text("Musique à la durée de la vidéo") .action.go');
    await page.waitForSelector('#status.ok:has-text("Musique ajustée")', { timeout: 20000 });
    await idle();
    if (!/Version d'avant gardée/.test(await page.textContent('#status-detail'))) throw new Error('version avant musique : ' + await page.textContent('#status-detail'));
    await goTab('formats');
    await page.click('.view.on .sec-nav .action:text-is("Versions")');
    await page.fill('.section:has-text("Versions de la séquence") input', 'avant retours');
    await page.click('.section:has-text("Versions de la séquence") .action.go');
    await page.waitForSelector('#status.ok:has-text("v03 (avant retours)")', { timeout: 5000 });
    await idle();
    await page.waitForSelector('.ver-item:has-text("v02 (avant musique)")', { timeout: 3000 });
    await page.click('.ver-item:has-text("v02 (avant musique)") .action.danger');
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("Version supprimée")', { timeout: 3000 });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('.ver-item')).some(e => /v02 \(avant musique\)/.test(e.textContent)), null, { timeout: 3000 });
  });
  await step('2.5 : projet (ranger, renommer, proxies)', async () => {
    await goTab('assets');
    for (const t of ['Ranger le projet', 'Renommer en série', 'Proxies', 'Dossiers surveillés']) {
      await page.evaluate(t => { const x = Array.from(document.querySelectorAll('.view.on .section-title')).find(e => e.textContent.indexOf(t) >= 0); if (x && x.closest('.section').classList.contains('folded')) x.click(); }, t);
    }
    await page.click('.section:has-text("Ranger le projet") .action:text-is("Voir ce qui sera rangé")');
    await page.waitForSelector('.section:has-text("Ranger le projet") .note:has-text("Vidéos")', { timeout: 5000 });
    await idle();
    await page.click('.section:has-text("Ranger le projet") .action.go');
    await page.waitForSelector('#status.ok:has-text("éléments rangés")', { timeout: 5000 });
    await idle();
    if (!/Rangement du projet/.test(await page.getAttribute('#undo', 'title'))) throw new Error('rangement annulable');
    await page.fill('.section:has-text("Renommer en série") input[aria-label="Modèle de nom"]', 'Interview_##');
    await page.click('.section:has-text("Renommer en série") .action:text-is("Aperçu")');
    await page.waitForSelector('.section:has-text("Renommer en série") .note:has-text("C0001.MP4 → Interview_01")', { timeout: 5000 });
    await page.click('.section:has-text("Renommer en série") .action.go');
    await page.waitForSelector('#status.ok:has-text("3 éléments renommés")', { timeout: 5000 });
    await idle();
    if (!/Renommage/.test(await page.getAttribute('#undo', 'title'))) throw new Error('renommage annulable');
    await page.waitForSelector('.section:has-text("Proxies") select', { timeout: 5000 });
    await page.click('.section:has-text("Proxies") .action.go');
    await page.waitForSelector('#status.ok:has-text("4 proxies en file")', { timeout: 5000 });
    await idle();
    await page.waitForSelector('#status:has-text("4 proxies attachés")', { timeout: 15000 });
    await page.click('.section:has-text("Proxies") .action:text-is("Activer / désactiver les proxies")');
    await page.waitForSelector('#status.ok:has-text("Proxies activés")', { timeout: 3000 });
  });
  await step('2.5 : macros, temps gagné, temps passé', async () => {
    await goTab('settings');
    await page.evaluate(() => { const x = Array.from(document.querySelectorAll('.view.on .section-title')).find(e => /Macros$/.test(e.textContent.trim())); if (x && x.closest('.section').classList.contains('folded')) x.click(); });
    await page.click('[data-sec=macros] .action:text-is("＋ Nouvelle macro")');
    await page.fill('.modal input.textfield', 'Livraison');
    await page.selectOption('.modal select', 'keepVersion');
    await page.click('.modal .action:text-is("＋ Ajouter")');
    await page.selectOption('.modal select', 'tidyProject');
    await page.click('.modal .action:text-is("＋ Ajouter")');
    if ((await page.locator('.modal .macro-step').count()) !== 2) throw new Error('2 étapes attendues');
    await page.click('.modal .cta');
    await page.waitForSelector('.macro-item:has-text("Livraison")');
    const id = await page.evaluate(() => window.RRFXApp.macros.list()[0].id);
    if (!(await page.evaluate(id => !!window.RRFXShortcuts.ACTIONS['macro:' + id] && window.RRFXApp.services.actionAvailable('macro:' + id), id))) throw new Error('macro absente des actions');
    await page.click('.macro-item:has-text("Livraison") .action:text-is("▶ Lancer")');
    await page.waitForSelector('#status:has-text("Macro « Livraison » terminée")', { timeout: 20000 });
    if (!/2 étapes/.test(await page.textContent('#status-detail'))) throw new Error('macro : ' + await page.textContent('#status-detail'));
    // Recherche rapide : la macro s'y trouve.
    await page.keyboard.press('Control+k');
    await page.fill('.pal-input', 'livraison');
    await page.waitForSelector('.pal-item:has-text("▶ Livraison")');
    await page.keyboard.press('Escape');
    await goTab('settings');
    const big = await page.textContent('[data-sec=gagne] .saved-big');
    if (/^0 min$/.test(big)) throw new Error('temps gagné à 0');
    const dl = page.waitForEvent('download', { timeout: 5000 });
    await page.click('[data-sec=gagne] .action:text-is("Créer la carte à partager")');
    if (!/\.png$/.test((await dl).suggestedFilename())) throw new Error('carte PNG');
    await page.waitForSelector('[data-sec=temps]');
  });
  await step('2.6 : raccords, coupes propres, correcteur', async () => {
    await goTab('speech');
    await page.click('.view.on .sec-nav .action:text-is("Raccords")');
    await page.click('.section:has-text("Raccords J-cut / L-cut") .action.go');
    await page.waitForSelector('#status.ok:has-text("3 J-cut")', { timeout: 5000 });
    await idle();
    if (!/J-cut/.test(await page.getAttribute('#undo', 'title'))) throw new Error('raccords annulables');
    await page.click('.section:has-text("Raccords J-cut / L-cut") .action:text-is("Recaler les coupes sur les blancs")');
    await page.waitForSelector('#status.ok:has-text("coupe")', { timeout: 15000 });
    await idle();
    await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:01,400\nbonjour  à tous!\n\n2\n00:00:03,000 --> 00:00:04,000\nUne phrase beaucoup trop longue pour une seule ligne de sous-titre qui déborde\n');
    await page.click('.view.on .sec-nav .action:text-is("Correcteur")');
    await page.click('.section:has-text("Correcteur de sous-titres") .action:text-is("Vérifier les sous-titres")');
    await page.waitForSelector('.section:has-text("Correcteur de sous-titres") .pf-item');
    await page.click('.section:has-text("Correcteur de sous-titres") .action.go');
    await page.waitForSelector('#status:has-text("sous-titres corrigés")', { timeout: 3000 });
    const srt = await page.evaluate(() => window.RRFXApp.speech.settings().srt);
    if (!/Bonjour à tous !/.test(srt)) throw new Error('srt corrigé : ' + srt);
  });
  await step('2.6 : rythme, export en lot, vérification de l\'image', async () => {
    await goTab('formats');
    await page.click('.view.on .sec-nav .action:text-is("Rythme")');
    await page.click('.section:has-text("Rythme du montage") .action.go');
    await page.waitForSelector('#status:has-text("plans · moyenne")', { timeout: 5000 });
    await idle();
    await page.waitForSelector('.section:has-text("Rythme du montage") .note:has-text("médiane")');
    await page.click('.view.on .sec-nav .action:text-is("Export")');
    await page.evaluate(() => { const t = document.querySelector('[data-sec=export] .section-title'); if (t && t.closest('.section').classList.contains('folded')) t.click(); });
    await page.selectOption('[data-sec=export] select >> nth=0', 'export');
    await page.evaluate(() => { window.RRFXApp.settings().livraison.picked = []; });
    await page.click('[data-sec=export] .action:text-is("Lister les séquences")');
    await page.waitForSelector('[data-sec=export] .seq-list label');
    await page.click('[data-sec=export] .seq-list label >> nth=0');
    await page.fill('[data-sec=export] input[aria-label="Client"]', 'Nike');
    await page.waitForSelector('[data-sec=export] .note:has-text("→ Nike_")');
    await page.click('[data-sec=export] .action.go');
    await page.waitForSelector('#status.ok:has-text("1 export en file")', { timeout: 5000 });
    await idle();
    await page.evaluate(() => { window.RRFXApp.settings().formatsPlus.pfImage = true; });
    await page.click('.view.on .sec-nav .action:text-is("Vérifier")');
    await page.click('.section:has-text("Vérifier avant export") .action.go');
    await page.waitForSelector('#status:has-text("remarques")', { timeout: 15000 });
    await idle();
  });
  await step('2.6 : crédits, archive, image de référence, astuce, badges', async () => {
    await goTab('music');
    await page.evaluate(() => { const t = document.querySelector('[data-sec=credits] .section-title'); if (t && t.closest('.section').classList.contains('folded')) t.click(); });
    await page.click('.section:has-text("Crédits musique et sons") .action:text-is("Lister les sons")');
    await page.waitForSelector('[data-sec=credits] .pf-item >> nth=2', { timeout: 5000 });
    await idle();
    await goTab('assets');
    await page.evaluate(() => { const t = document.querySelector('[data-sec=archive] .section-title'); if (t && t.closest('.section').classList.contains('folded')) t.click(); });
    await page.click('.section:has-text("Archiver le projet") .action:text-is("Voir la taille")');
    await page.waitForSelector('[data-sec=archive] .note:has-text("4 médias utilisés")', { timeout: 3000 });
    await goTab('color');
    await page.evaluate(() => { const p = document.querySelector('[data-panel=fix]'); if (p && p.classList.contains('closed')) p.querySelector('.lr-head').click(); });
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.click('[data-panel=fix] .action:has-text("ou une image")');
    await (await chooser).setFiles(png);
    await page.waitForSelector('#status.ok:has-text("Référence : light-leak.png")', { timeout: 5000 });
    await page.evaluate(() => window.RRFXApp.tips.show(window.RRFXApp.tips.all()[0]));
    await page.waitForSelector('.tip-bar');
    await page.click('.tip-bar .action:text-is("Voir")');
    await page.waitForSelector('.tab.on[data-tab=speech]');
    if (await page.isVisible('.tip-bar')) throw new Error('astuce restée affichée');
    await goTab('settings');
    if ((await page.locator('[data-sec=gagne] .badge').count()) !== 10) throw new Error('10 badges attendus');
    if ((await page.locator('[data-sec=gagne] .badge.on').count()) < 1) throw new Error('au moins un badge débloqué');
  });
  await step('mode réduit', async () => {
    await page.click('#toggle-compact');
    if (!(await page.isHidden('#scroll'))) throw new Error('le contenu devrait être masqué');
    await page.click('#toggle-compact');
  });
  await step('2.7 : onglets regroupés et menu Fenêtres', async () => {
    // Montage : un clic sur le groupe ouvre ses sous-onglets.
    await page.click('.tab-group[data-group=montage]');
    await page.waitForSelector('#subtabs:not(.hidden) .tab[data-tab=ramp]');
    await page.click('#subtabs .tab[data-tab=ramp]');
    await page.waitForSelector('.tab.on[data-tab=ramp]');
    await page.waitForSelector('.tab-group.on[data-group=montage]');
    // Espace « Essentiel » : Rampe et Mes effets masqués, Chapitres et Respirations aussi.
    await page.click('#open-windows');
    await page.click('.modal .win-spaces .action:text-is("Essentiel")');
    await page.click('.modal footer .cta');
    if (await page.isVisible('.tab[data-tab=ramp]')) throw new Error('Rampe devrait être masquée');
    if (!(await page.isVisible('.tab.on[data-tab=effects]')) && !(await page.isVisible('.tab.on[data-tab=music]'))) throw new Error('onglet de repli attendu dans Montage');
    await goTab('speech');
    if (await page.isVisible('[data-sec=chapitres]')) throw new Error('Chapitres devrait être masqué');
    if (await page.isVisible('.sec-nav [data-target=chapitres]')) throw new Error('bouton du sommaire masqué attendu');
    if (!(await page.isVisible('[data-sec=silences]'))) throw new Error('Silences devrait rester');
    // La recherche rapide réaffiche un outil masqué.
    await page.keyboard.press('Control+k');
    await page.fill('.pal-input', 'respirations et clics');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-sec=souffle]', { state: 'visible', timeout: 3000 });
    // Un outil masqué depuis le menu, puis tout réaffiché.
    await page.click('#open-windows');
    await page.click('.modal .win-group:has-text("Parole") label:has-text("Couper les silences")');
    await page.click('.modal footer .cta');
    if (await page.isVisible('[data-sec=silences]')) throw new Error('Silences devrait être masqué');
    await page.click('#open-windows');
    await page.click('.modal footer button:has-text("Tout afficher")');
    await page.waitForSelector('[data-sec=silences]', { state: 'visible' });
    if (!(await page.isVisible('.tab-group[data-group=montage]'))) throw new Error('Montage');
    const space = await page.evaluate(() => window.RRFXApp.settings().layout.space);
    if (space !== 'all') throw new Error('espace : ' + space);
  });
  await step('2.7 : outils de Premiere (transitions, changements de plan, sous-titres)', async () => {
    await goTab('native');
    await page.waitForSelector('.tab.on[data-tab=native]');
    await page.click('[data-sec=transitions] .action.go');
    await page.waitForSelector('#status.ok:has-text("transitions")', { timeout: 5000 });
    await idle();
    const h = await page.evaluate(() => window.RRFXApp.S.lib.history.slice(-1)[0]);
    if (!h || !h.entries.some(e => e.kind === 'trans')) throw new Error('historique sans transitions');
    await page.click('[data-sec=transitions] .action:text-is("Fondus audio anti-clic")');
    await page.waitForSelector('#status.ok:has-text("fondus audio")', { timeout: 5000 });
    await idle();
    await page.click('[data-sec=scenes] .action.go');
    await page.waitForSelector('#status.ok:has-text("6 marqueurs")', { timeout: 5000 });
    await idle();
    await page.evaluate(() => { window.RRFXApp.speech.settings().srt = '1\n00:00:01,000 --> 00:00:03,000\nBonjour\n'; });
    await page.click('[data-sec=captions] .action.go');
    await page.waitForSelector('#status.ok:has-text("Piste de sous-titres")', { timeout: 5000 });
    await idle();
    if ((await page.textContent('#cta')) !== 'Poser les transitions de Premiere') throw new Error('CTA : ' + await page.textContent('#cta'));
  });
  await step('2.8 : transcription Whisper (démo), « euh » au mot près', async () => {
    await goTab('speech');
    await page.evaluate(() => { window.RRFXApp.speech.settings().srt = ''; });
    await page.click('.view.on .sec-nav .action:text-is("Transcrire")');
    await page.click('[data-sec=transcrire] .action.go');
    await page.waitForSelector('#status.ok:has-text("sous-titres")', { timeout: 10000 });
    await idle();
    const srt = await page.evaluate(() => window.RRFXApp.speech.settings().srt);
    if (!/Bonjour à tous/.test(srt) || /euh/.test(srt)) throw new Error('srt : ' + srt.slice(0, 200));
    if (!(await page.evaluate(() => window.RRFXApp.transcript.has()))) throw new Error('mots non gardés');
    const f = await page.evaluate(() => [window.RRFXApp.transcript.fillers().length, window.RRFXApp.transcript.repeats().length]);
    if (f[0] < 2 || f[1] < 1) throw new Error('euh / répétitions : ' + f);
    await page.evaluate(() => { window.RRFXApp.speech.settings().fillerMode = 'markers'; });
    await page.click('.view.on .sec-nav .action:text-is("Euh")');
    await page.click('[data-sec=euh] .action.go');
    await page.waitForSelector('#status.ok:has-text("marqué")', { timeout: 10000 });
    await idle();
  });
  await step('langue : passage en anglais', async () => {
    await goTab('settings');
    await page.click('[data-sec=lang] button:has-text("English")');
    await page.waitForFunction(() => document.documentElement.lang === 'en' && window.RRFXApp, null, { timeout: 20000 });
    await page.waitForSelector('.tab[data-tab=speech]:has-text("Speech")');
    for (const t of ['express', 'effects', 'color', 'speech', 'formats', 'settings']) await goTab(t);
    await page.waitForSelector('.section-title:has-text("Remote control")');
    await page.click('[data-sec=lang] button:has-text("Français")');
    await page.waitForFunction(() => document.documentElement.lang === 'fr' && window.RRFXApp, null, { timeout: 20000 });
    await page.waitForSelector('.tab[data-tab=speech]:has-text("Parole")');
  });
  await step('langue : choix au premier lancement', async () => {
    await page.evaluate(() => { localStorage.removeItem('rrfx-lang'); localStorage.removeItem('rrfx-nowelcome'); });
    const fresh = await browser.newPage({ viewport: { width: 360, height: 820 } });
    await fresh.context().route('https://www.instagram.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: 'Instagram' }));
    fresh.on('pageerror', e => errors.push('premier lancement : ' + e.message));
    await fresh.goto(url);
    await fresh.waitForSelector('.modal-title:has-text("Langue · Language")');
    await fresh.click('.modal footer button:has-text("English")');
    await fresh.waitForSelector('.modal-title:has-text("Welcome to RR FX")', { timeout: 8000 });
    // Instagram : seulement si on clique sur « Suivre », jamais tout seul.
    let early = false;
    fresh.once('popup', () => { early = true; });
    await fresh.waitForTimeout(300);
    if (early) throw new Error('Instagram ouvert sans clic');
    const insta = fresh.waitForEvent('popup', { timeout: 5000 });
    await fresh.click('.modal .wl-follow:has-text("Follow @robin.rahoual")');
    const pop = await insta;
    if (!/instagram\.com\/robin\.rahoual/.test(pop.url())) throw new Error('Instagram : ' + pop.url());
    await pop.close();
    await fresh.click('.modal .cta');
    await fresh.evaluate(() => window.RRFXApp.services.welcome());
    let again = false;
    fresh.once('popup', () => { again = true; });
    await fresh.click('.modal .cta');
    await fresh.waitForTimeout(300);
    if (again) throw new Error('Instagram ouvert une deuxième fois');
    await fresh.close();
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) {
    console.error('Échecs :\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('Interface OK');
})();
