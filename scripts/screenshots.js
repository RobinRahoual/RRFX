#!/usr/bin/env node
/*
 * Captures d'écran de chaque page du panneau (mode démo, données d'exemple), pour le
 * README, les réseaux ou une présentation. Nécessite Playwright (et ffmpeg pour les
 * vidéos d'exemple de l'onglet Ressources, facultatif).
 *
 *   node scripts/screenshots.js <dossier-captures> [largeur]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const demo = require('./demo-assets.js');
const { song, ISSUES } = demo;
const { addFolder } = require('./demo-files.js');

const out = path.resolve(process.argv[2] || 'captures');
const WIDTH = Number(process.argv[3]) || 380;
const url = 'file://' + path.join(__dirname, '..', 'plugin', 'index.html');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-shots-'));
  const pack = demo.make(path.join(tmp, 'Pack Robin'));
  const music = path.join(tmp, 'Nuit blanche.wav');
  song(music, 40);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: /\/issues\?/.test(r.request().url()) ? JSON.stringify(ISSUES) : '{}' }));
  await page.route('https://github.com/**', r => r.fulfill({ status: 200, body: 'GitHub' }));
  // L'accueil de la première ouverture a son propre test.
  await page.addInitScript(() => { try { localStorage.setItem('rrfx-nowelcome', '1'); } catch (e) { /* stockage indisponible */ } });
  await page.goto(url);
  await page.click('.tab[data-tab=effects]');
  await page.waitForSelector('#grid .card');
  await page.waitForTimeout(400);

  const close = async () => { if (await page.isVisible('#status-close')) await page.click('#status-close'); };
  let n = 0;
  // Capture du panneau entier : la fenêtre prend la hauteur du contenu.
  async function shot(name, settle) {
    await page.waitForTimeout(settle || 500);
    const h = await page.evaluate(() => {
      // Hauteur du contenu de l'onglet (pas celle de la zone de défilement, qui remplit la fenêtre).
      const s = document.getElementById('scroll'), r = s.getBoundingClientRect();
      let bottom = 0;
      s.querySelectorAll('.view.on > *').forEach(c => { bottom = Math.max(bottom, c.getBoundingClientRect().bottom - r.top + s.scrollTop); });
      return Math.ceil(r.top + bottom + 16);
    });
    await page.setViewportSize({ width: WIDTH, height: Math.min(3200, Math.max(400, h)) });
    await page.evaluate(() => { document.getElementById('scroll').scrollTop = 0; });
    await page.waitForTimeout(350);
    const file = path.join(out, String(++n).padStart(2, '0') + '-' + name + '.png');
    await page.screenshot({ path: file });
    await page.setViewportSize({ width: WIDTH, height: 900 });
    console.log(file);
  }

  // 0. Express
  await page.click('.tab[data-tab=express]');
  await page.waitForSelector('.xp-check');
  await page.waitForTimeout(600);
  await close();
  await shot('express', 600);
  await page.click('.tab[data-tab=effects]');

  // 1. Effets
  await page.click('#grid .card:has-text("Zoom rotation")');
  await page.selectOption('.section:has-text("Placement") select >> nth=0', 'markers');
  await close();
  await shot('effets');

  // 2. Overlays
  await page.click('.chips .action:has-text("Overlays")');
  await page.click('#grid .card:has-text("Leak chaud")');
  await shot('effets-overlays', 900);

  // 3. Rampe
  await page.click('.tab[data-tab=ramp]');
  await shot('rampe');

  // Couleur : look appliqué, avant | après ; puis tous les panneaux ouverts.
  await page.click('.tab[data-tab=color]');
  await page.waitForSelector('.lr-look');
  await page.click('.lr-look:has-text("Clip musical")');
  await close();
  await shot('couleur', 900);
  for (const t of ['Courbe des tonalités', 'Mélangeur de couleurs', 'Étalonnage des couleurs', 'Calibrage']) await page.click('.lr-head:has-text("' + t + '")');
  await page.click('.lr-head:has-text("Looks")');
  await page.click('.lr-head:has-text("Réglages de base")');
  await page.click('.lr-panel:has-text("Courbe des tonalités") .action:text-is("RVB")');
  await page.click('.lr-panel:has-text("Étalonnage") .action:text-is("3 roues")');
  await shot('couleur-panneaux', 900);
  // Panneaux remis comme au départ pour la suite.
  for (const t of ['Courbe des tonalités', 'Mélangeur de couleurs', 'Étalonnage des couleurs', 'Calibrage', 'Looks', 'Réglages de base']) await page.click('.lr-head:has-text("' + t + '")');

  // Conversion LOG → Rec.709 : deux caméras enregistrées, puis l'ajout d'une caméra.
  await page.evaluate(() => {
    window.RRFXApp.settings().logconv = { active: 'a', scope: 'sequence', cams: [
      { id: 'a', brand: 'sony', model: 'A7 III', profile: 'slog3-sg3c', mode: 'lut', lut: '', lutName: 'SLog3SGamut3.CineToLC-709.cube', ev: 0, contrast: 'standard' },
      { id: 'b', brand: 'apple', model: 'iPhone 16 Pro', profile: 'applelog', mode: 'calc', ev: 1, contrast: 'standard' }] };
  });
  await page.click('.tab[data-tab=ramp]');
  await page.click('.tab[data-tab=color]');
  await page.click('.lr-head:has-text("Looks")');
  await page.click('.lr-head:has-text("Réglages de base")');
  await shot('couleur-conversion', 900);
  await page.click('.lr-head:has-text("Expo, balance et raccord")');
  await page.click('.action:has-text("Prendre la référence")');
  await page.waitForSelector('.fix-ref img');
  await page.click('.action:has-text("Raccorder la sélection")');
  await page.waitForSelector('.fix-preview canvas');
  await close();
  await shot('couleur-raccord', 900);
  await page.click('.lr-head:has-text("Expo, balance et raccord")');
  await page.click('.action:has-text("+ Ajouter une caméra")');
  await page.selectOption('.conv-form .row:has-text("Marque") select', 'panasonic');
  await page.fill('.conv-form .row:has-text("Modèle") input', 'GH5');
  await page.click('.conv-form .action:text-is("Calculée")');
  await shot('couleur-conversion-camera', 600);
  await page.click('.conv-form .action:has-text("Annuler")');
  await page.click('.lr-head:has-text("Looks")');
  await page.click('.lr-head:has-text("Réglages de base")');

  // 4. Musique : analyse d'un morceau et temps forts posés
  await page.click('.tab[data-tab=music]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action:has-text("Choisir un fichier")')]);
  await chooser.setFiles(music);
  await page.waitForSelector('#status.ok:has-text("Musique analysée")', { timeout: 15000 });
  await page.click('#cta');
  await page.waitForSelector('#status.ok', { timeout: 5000 });
  await close();
  await shot('musique');

  // 5. Textes
  await page.click('.tab[data-tab=titles]');
  await page.fill('textarea.lyrics', 'On roule la nuit\nLes phares dans les yeux\nRien ne nous arrête\nJusqu\'au matin');
  await shot('textes', 900);

  // Parole : silences analysés.
  await page.click('.tab[data-tab=speech]');
  await page.click('button:has-text("Analyser")');
  await page.waitForSelector('#status.ok:has-text("silences trouvés")', { timeout: 10000 });
  await shot('parole', 600);

  // Formats : copie 9:16 avec les zones sûres.
  await page.click('.tab[data-tab=formats]');
  await shot('formats', 700);

  // 6-8. Ressources
  await page.click('.tab[data-tab=assets]');
  await shot('ressources-vide');
  await addFolder(page, pack);
  await page.waitForSelector('#res-grid .card');
  await close();
  await page.click('#res-grid .card:has-text("Teal")');
  await shot('ressources-lut', 1500);
  await page.click('.chips .action:has-text("Sons")');
  await page.click('#res-grid .card:has-text("Whoosh rapide")');
  await shot('ressources-sfx', 1200);
  await page.click('.chips .action:has-text("Polices")');
  await page.click('#res-grid .card:has-text("DejaVu Sans Bold")');
  await shot('ressources-police', 1200);

  // 9. Mes effets : une bibliothèque remplie
  await page.evaluate(() => window.RRFXApp.services.addItems([
    { type: 'preset', name: 'Zoom drop perso', cat: 'zoom', data: { base: 'zoom-in', params: { frames: 6, intensity: 140 } } },
    { type: 'ramp', name: 'Rampe refrain', data: { points: [{ t: 0, v: 100 }, { t: 0.6, v: 25 }, { t: 1, v: 300 }], frames: 16, segments: 10 } },
    { type: 'preset', name: 'Flash refrain', cat: 'flash', data: { base: 'flash-white', params: { frames: 5, intensity: 110 } } }
  ]));
  await page.click('.tab[data-tab=mine]');
  await page.click('#cta'); // capture (démo)
  await page.waitForSelector('#status.ok', { timeout: 5000 });
  await close();
  await shot('mes-effets');

  // 10. Communauté
  await page.click('.mine-switch .action:has-text("Communauté")');
  await page.waitForSelector('.comm-item');
  await close();
  await shot('communaute', 900);
  await page.click('.mine-switch .action:has-text("Ma bibliothèque")');

  // 11. Réglages
  await page.click('.tab[data-tab=settings]');
  await close();
  await shot('reglages');

  // 12. Mode réduit
  await page.click('.tab[data-tab=effects]');
  await page.click('#toggle-compact');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, String(++n).padStart(2, '0') + '-mode-reduit.png'), clip: { x: 0, y: 0, width: WIDTH, height: await page.evaluate(() => Math.ceil(document.getElementById('status').getBoundingClientRect().bottom) + 12) } });
  await page.click('#toggle-compact');

  // 13. Thème clair (Premiere réglé en clair)
  await page.evaluate(() => { document.body.classList.add('theme-light'); document.body.classList.remove('theme-dark'); document.documentElement.style.setProperty('--bg', 'rgb(214,214,214)'); window.RRFXUI.css.reset(); });
  await page.click('.tab[data-tab=assets]');
  await page.click('.chips .action:has-text("Tout")');
  await page.click('#res-grid .card:has-text("Nuit bleue")');
  await shot('theme-clair', 1500);

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) { console.error('Erreurs :\n- ' + errors.join('\n- ')); process.exit(1); }
})();
