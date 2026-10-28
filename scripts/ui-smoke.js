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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutfx-ui-'));
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
    try { await fn(); } catch (e) { errors.push(label + ' : ' + e.message.split('\n')[0]); }
  };

  await page.goto(url);
  await page.waitForTimeout(800);
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
  await step('intensité selon le volume', async () => {
    await page.click('.tab[data-tab=effects]');
    await page.click('.chips .action:text-is("Tout")');
    await page.click('.card:has-text("Zoom rotation")');
    await page.click('.section:has-text("Placement") label:has-text("suit le volume")');
    await page.click('#cta');
    await page.waitForSelector('#status.ok, #status.warn', { timeout: 8000 });
    const log = await page.evaluate(() => window.CutFXApp.S.logLines.map(l => l.message).join('\n'));
    if (!/Intensité selon le volume/.test(log)) throw new Error('le volume n\'a pas été lu');
  });
  await step('textes', async () => {
    await page.click('.tab[data-tab=titles]');
    await page.fill('textarea.lyrics', 'Premier\nDeuxième\nTroisième');
    await page.click('#cta');
    await page.waitForSelector('#status.ok:has-text("texte")', { timeout: 8000 });
    await snap('8-textes');
  });
  await step('partage', async () => {
    await page.click('.tab[data-tab=mine]');
    await page.click('.list-item .action[title^="Partager"] >> nth=0');
    const code = await page.inputValue('.modal textarea');
    if (!/^CUTFX[01]:/.test(code)) throw new Error('code de partage invalide');
    await page.click('.modal .cta');
    const before = await page.locator('.list-item').count();
    await page.click('.action:has-text("Coller un code")');
    await page.fill('.modal textarea', code);
    await page.click('.modal .cta');
    await page.waitForSelector('#status.ok:has-text("ajouté")', { timeout: 3000 });
    if ((await page.locator('.list-item').count()) !== before + 1) throw new Error('l\'effet partagé n\'a pas été ajouté');
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
