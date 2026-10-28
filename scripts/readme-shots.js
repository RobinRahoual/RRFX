#!/usr/bin/env node
/*
 * Captures « en situation » pour le README : une par outil, le panneau à la taille d'un
 * vrai panneau Premiere, la bonne section à l'écran (mode démo, données d'exemple).
 *
 *   node scripts/readme-shots.js docs/captures/outils
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const demo = require('./demo-assets.js');
const { addFolder } = require('./demo-files.js');

const out = path.resolve(process.argv[2] || 'docs/captures/outils');
const W = 380, H = 760;
const url = 'file://' + path.join(__dirname, '..', 'plugin', 'index.html');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-readme-'));
  const pack = demo.make(path.join(tmp, 'Pack Robin'));
  const music = path.join(tmp, 'Nuit blanche.wav');
  demo.song(music, 40);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: /\/issues\?/.test(r.request().url()) ? JSON.stringify(demo.ISSUES) : '{}' }));
  await page.route('https://github.com/**', r => r.fulfill({ status: 200, body: 'GitHub' }));
  // L'accueil de la première ouverture a son propre test.
  await page.addInitScript(() => { try { localStorage.setItem('rrfx-nowelcome', '1'); } catch (e) { /* stockage indisponible */ } });
  await page.goto(url);
  await page.click('.tab[data-tab=effects]');
  await page.waitForSelector('#grid .card');
  await page.waitForTimeout(400);

  const close = async () => { if (await page.isVisible('#status-close')) await page.click('#status-close'); };
  const tab = async t => { await page.click('.tab[data-tab=' + t + ']'); await page.waitForTimeout(250); };
  // La section voulue en haut de la zone de défilement (sous le bouton principal et l'état).
  async function shot(name, selector, settle) {
    await page.waitForTimeout(settle || 500);
    await page.evaluate(sel => {
      const s = document.getElementById('scroll');
      s.scrollTop = 0;
      if (!sel) return;
      const el = document.querySelector(sel);
      if (el) s.scrollTop = el.getBoundingClientRect().top - s.getBoundingClientRect().top - 6;
    }, selector || null);
    await page.waitForTimeout(300);
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    console.log(file);
  }
  const mark = async (sel, attr) => page.evaluate(([s, a]) => { document.querySelectorAll('[data-shot]').forEach(e => e.removeAttribute('data-shot')); const el = typeof s === 'string' ? Array.from(document.querySelectorAll(s.split('|')[0])).find(e => e.textContent.includes(s.split('|')[1])) : null; if (el) el.setAttribute('data-shot', a); }, [sel, attr]);

  // Effets : une transition choisie, posée sur les marqueurs.
  await page.click('#grid .card:has-text("Zoom rotation")');
  await page.selectOption('.section:has-text("Placement") select >> nth=0', 'markers');
  await close();
  await shot('effets');
  // Transitions douces et mouvements : la catégorie Mouvements.
  await page.click('.chips .action:has-text("Mouvements")');
  await page.click('#grid .card:has-text("Zoom visage") >> nth=0');
  await close();
  await shot('effets-mouvements', null, 700);
  await page.click('.chips .action:has-text("Tout")');
  await page.click('#grid .card:has-text("Zoom rotation")');
  await page.selectOption('.section:has-text("Placement") select >> nth=0', 'markers');

  // Enchaînement sur les temps forts.
  await page.selectOption('.section:has-text("Placement") .row:has-text("Entre les coupes") select', 'chain');
  for (const n of ['Zoom in', 'Flash blanc', 'Shake']) await page.click('#grid .card:has-text("' + n + '")', { modifiers: ['Shift'] });
  await close();
  await mark('.section|Placement', 'pl');
  await shot('enchainement', '[data-shot=pl]');
  for (const n of ['Zoom in', 'Flash blanc', 'Shake']) await page.click('.chain-chip:has-text("' + n + '")');
  await page.selectOption('.section:has-text("Placement") .row:has-text("Entre les coupes") select', 'seed');

  // Overlays.
  await page.click('.chips .action:has-text("Overlays")');
  await page.click('#grid .card:has-text("Leak chaud")');
  await close();
  await shot('overlays', null, 900);
  await page.click('.chips .action:text-is("Tout")');

  // Rampe.
  await tab('ramp');
  await shot('rampe');

  // Couleur : caméras enregistrées, conversion.
  await page.evaluate(() => {
    window.RRFXApp.settings().logconv = { active: 'a', scope: 'sequence', mode: 'auto', unknown: 'active', autoFix: true, cams: [
      { id: 'a', brand: 'sony', model: 'A7 III', profile: 'slog3-sg3c', mode: 'lut', lut: '', lutName: 'SLog3SGamut3.CineToLC-709.cube', ev: 0, contrast: 'standard' },
      { id: 'b', brand: 'apple', model: 'iPhone 16 Pro', profile: 'applelog', mode: 'calc', ev: 1, contrast: 'standard' }] };
  });
  await tab('color');
  await page.waitForSelector('.lr-look');
  await page.click('.lr-look:has-text("Clip musical")');
  await page.click('.lr-head:has-text("Looks")');
  await page.click('.lr-head:has-text("Réglages de base")');
  await close();
  await shot('conversion', '.lr-panel:has(.conv-cam)', 800);
  await page.click('.action:has-text("+ Ajouter une caméra")');
  await page.selectOption('.conv-form .row:has-text("Marque") select', 'sony');
  await page.fill('.conv-form .row:has-text("Modèle") input', 'A7 III');
  await shot('conversion-camera', '.lr-panel:has(.conv-form)');
  await page.click('.conv-form .action:has-text("Annuler")');

  // Expo, balance et raccord.
  await page.click('.lr-head:has-text("Conversion LOG")');
  await page.click('.lr-head:has-text("Expo, balance et raccord")');
  await page.click('.action:has-text("Prendre la référence")');
  await page.waitForSelector('.fix-ref img');
  await page.click('.action:has-text("Raccorder la sélection")');
  await page.waitForSelector('.fix-preview canvas');
  await close();
  await shot('raccord', '.lr-panel:has(.fix-ref)', 600);
  await page.click('.lr-head:has-text("Expo, balance et raccord")');

  // Étalonnage façon Lightroom : aperçu avant | après et looks.
  await page.click('.lr-head:has-text("Looks")');
  await shot('couleur', null, 800);
  await page.click('.lr-head:has-text("Looks")');
  for (const t of ['Courbe des tonalités', 'Étalonnage des couleurs']) await page.click('.lr-head:has-text("' + t + '")');
  await page.click('.lr-panel:has-text("Étalonnage") .action:text-is("3 roues")');
  await mark('.lr-panel|Courbe des tonalités', 'cv');
  await shot('couleur-panneaux', '[data-shot=cv]', 800);
  for (const t of ['Courbe des tonalités', 'Étalonnage des couleurs']) await page.click('.lr-head:has-text("' + t + '")');
  await page.click('.lr-head:has-text("Conversion LOG")');
  await page.click('.lr-head:has-text("Looks")');
  await page.click('.lr-head:has-text("Réglages de base")');

  // Musique : morceau analysé, temps forts.
  await tab('music');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action:has-text("Choisir un fichier")')]);
  await chooser.setFiles(music);
  await page.waitForSelector('#status.ok:has-text("Musique analysée")', { timeout: 15000 });
  await page.click('#cta');
  await page.waitForSelector('#status.ok', { timeout: 5000 });
  await close();
  await shot('musique');
  await mark('.section|Montage auto', 'mt');
  await shot('montage', '[data-shot=mt]');

  // Textes.
  await tab('titles');
  await page.fill('textarea.lyrics', 'On roule la nuit\nLes phares dans les yeux\nRien ne nous arrête\nJusqu\'au matin');
  await mark('.section|Animation', 'an');
  await shot('textes', '[data-shot=an]', 900);

  // Express : le style choisi, les vérifications, puis le compte rendu du clip.
  await page.evaluate(() => { const t = window.RRFXApp.settings().titles; t.mogrt = t.mogrt || 'demo'; });
  await tab('express');
  await page.waitForSelector('.xp-check');
  await page.waitForTimeout(600);
  await page.click('.xp-style:has-text("Rap énergique")');
  await close();
  await shot('express', null, 700);
  await mark('.section|1. Style', 'st');
  await shot('express-styles', '[data-shot=st]', 500);
  await page.click('#cta');
  await page.waitForFunction(() => /prêt|revoir/.test(document.getElementById('status-title').textContent), null, { timeout: 60000 });
  await mark('.section|Dernier montage express', 'rp');
  await shot('express-resultat', '[data-shot=rp]', 600);
  // D'autres styles : interview, Reels.
  await page.click('.xp-style:has-text("Interview")');
  await close();
  await mark('.section|1. Style', 'st');
  await shot('express-interview', '[data-shot=st]', 700);
  await page.click('.xp-style:has-text("Reels dynamique")');
  await close();
  await shot('express-reels', null, 700);

  // Parole : silences analysés, sous-titres.
  await tab('speech');
  await page.click('button:has-text("Analyser")');
  await page.waitForSelector('#status.ok:has-text("silences trouvés")', { timeout: 10000 });
  await shot('parole', null, 500);
  await page.fill('.section:has-text("Sous-titres") textarea', '1\n00:00:01,000 --> 00:00:03,200\nBienvenue dans notre nouvel atelier\n\n2\n00:00:03,400 --> 00:00:06,000\nOn vous montre tout en deux minutes');
  await page.click('.section:has-text("Sous-titres") .action:has-text("Mot par mot")');
  await page.fill('.section:has-text("Bandeau") input >> nth=0', 'Camille Martin');
  await page.fill('.section:has-text("Bandeau") input >> nth=1', 'Directrice marketing');
  await close();
  await mark('.section|Sous-titres', 'sub');
  await shot('parole-sous-titres', '[data-shot=sub]', 500);

  // Recherche rapide.
  await page.keyboard.press('Control+k');
  await page.fill('.pal-input', 'zoom');
  await shot('recherche', null, 400);
  await page.keyboard.press('Escape');

  // Formats.
  await tab('formats');
  await shot('formats', null, 700);
  await page.click('.section:has-text("Cadrage") .action:has-text("Fond flou")');
  await shot('formats-fond-flou', null, 700);
  await page.click('.section:has-text("Cadrage") .action:has-text("Recadrage auto")');

  // Ressources.
  await tab('assets');
  await addFolder(page, pack);
  await page.waitForSelector('#res-grid .card');
  await close();
  await page.click('#res-grid .card:has-text("Teal")');
  await shot('ressources', null, 1500);

  // Mes effets : bibliothèque et packs de style.
  await page.evaluate(() => window.RRFXApp.services.addItems([
    { type: 'preset', name: 'Zoom drop perso', cat: 'zoom', data: { base: 'zoom-in', params: { frames: 6, intensity: 140 } } },
    { type: 'ramp', name: 'Rampe refrain', data: { points: [{ t: 0, v: 100 }, { t: 0.6, v: 25 }, { t: 1, v: 300 }], frames: 16, segments: 10 } },
    { type: 'look', name: 'Nuit perso', data: { params: { exposure: -0.3, temp: -12 } } }
  ]));
  await tab('mine');
  await page.click('#cta');
  await page.waitForSelector('#status.ok', { timeout: 5000 });
  await close();
  await mark('.section|Ma bibliothèque', 'lib');
  await shot('mes-effets', '[data-shot=lib]');
  await page.click('.mine-switch .action:has-text("Communauté")');
  await page.waitForSelector('.comm-item');
  await close();
  await shot('communaute', null, 900);

  // Test de compatibilité (Réglages) et accueil.
  await tab('settings');
  await page.evaluate(() => window.RRFXApp.diagnostic.run());
  await page.waitForSelector('#status.ok:has-text("Tout fonctionne")', { timeout: 8000 });
  await mark('.section|Test de compatibilité', 'tc');
  await shot('test-compatibilite', '[data-shot=tc]', 500);
  await page.evaluate(() => window.RRFXApp.services.welcome());
  await page.waitForSelector('.modal:has-text("Bienvenue")');
  await shot('accueil', null, 500);

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) { console.error('Erreurs :\n- ' + errors.join('\n- ')); process.exit(1); }
})();
