#!/usr/bin/env node
/*
 * Test d'interface : ouvre le panneau en mode démo dans Chromium (Playwright),
 * parcourt les onglets et les actions principales, et échoue à la moindre
 * erreur JavaScript. Nécessite Playwright : npm i -D playwright && npx playwright install chromium
 *
 *   node scripts/ui-smoke.js [dossier-captures]
 */

'use strict';

const path = require('path');
const { chromium } = require('playwright');

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
  if (errors.length) {
    console.error('Échecs :\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('Interface OK');
})();
