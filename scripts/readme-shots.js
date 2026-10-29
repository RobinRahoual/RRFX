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
  // Onglet : un clic sur son groupe (Montage, Bibliothèque) puis sur le sous-onglet, comme à la main.
  const goTab = async (t, p) => {
    p = p || page;
    const g = await p.evaluate(x => { const gr = window.RRFXLayout.groupOf(x); return gr && gr.tabs.length > 1 ? gr.id : ''; }, t);
    if (g && !(await p.isVisible('#subtabs .tab[data-tab=' + t + ']'))) await p.click('.tab-group[data-group=' + g + ']');
    if (await p.isVisible('.tab[data-tab=' + t + ']')) await p.click('.tab[data-tab=' + t + ']');
  };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: /\/issues\?/.test(r.request().url()) ? JSON.stringify(demo.ISSUES) : '{}' }));
  await page.route('https://github.com/**', r => r.fulfill({ status: 200, body: 'GitHub' }));
  // L'accueil de la première ouverture a son propre test.
  await page.addInitScript(() => { try { localStorage.setItem('rrfx-nowelcome', '1'); } catch (e) { /* stockage indisponible */ } });
  await page.goto(url);
  await goTab('effects');
  await page.waitForSelector('#grid .card');
  await page.waitForTimeout(400);

  const close = async () => { if (await page.isVisible('#status-close')) await page.click('#status-close'); };
  const tab = async t => { await goTab(t); await page.waitForTimeout(250); };
  // La section voulue en haut de la zone de défilement (sous le bouton principal et l'état).
  async function shot(name, selector, settle) {
    await page.waitForTimeout(settle || 500);
    await page.evaluate(sel => {
      const s = document.getElementById('scroll');
      s.scrollTop = 0;
      if (!sel) return;
      // De la place sous la dernière section : elle peut monter en haut comme les autres.
      const v = document.querySelector('.view.on');
      if (v) v.style.paddingBottom = '700px';
      const el = document.querySelector(sel);
      // Sommaire collant (onglet Parole) : la section se place juste dessous.
      const nav = document.querySelector('.view.on .sec-nav');
      if (el) s.scrollTop = el.getBoundingClientRect().top - s.getBoundingClientRect().top - 6 - (nav && nav !== el ? nav.offsetHeight + 4 : 0);
    }, selector || null);
    await page.waitForTimeout(300);
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    await page.evaluate(() => { const v = document.querySelector('.view.on'); if (v) v.style.paddingBottom = ''; });
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
  // Zoom suivi (objet) : l'objet entouré sur la première image.
  await page.click('#grid .card:has-text("Zoom suivi")');
  await page.click('#cta');
  await page.waitForSelector('.trk-canvas', { timeout: 15000 });
  const tb = await page.locator('.trk-canvas').boundingBox();
  await page.mouse.move(tb.x + tb.width * 0.52, tb.y + tb.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width * 0.72, tb.y + tb.height * 0.62);
  await page.mouse.up();
  await shot('suivi-objet', null, 400);
  await page.click('.modal .button-secondary');
  await page.waitForFunction(() => !window.RRFXApp.S.busy, null, { timeout: 10000 });
  await close();
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
  await shot('rampes-predefinies', '.ramp-groups', 400);

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
  // Mes LUTs (LUTs d'exemple ici) et dégradé de couleur.
  await page.click('.lr-panel:has(.lut-grid) .lut-card >> nth=2');
  await shot('mes-luts', '.lr-panel:has(.lut-grid)', 900);
  await page.click('.view.on .sec-nav .action:text-is("Dégradés")');
  await page.selectOption('.lr-panel:has(.grad-swatch) select >> nth=0', 'b:teal-orange');
  await shot('degrade', '.lr-panel:has(.grad-swatch)', 700);
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
  await page.selectOption('.section:has-text("Style du texte") select >> nth=0', 'b:reels');
  await page.click('.section:has-text("Style du texte") .action:has-text("Modifier")');
  await mark('.section|Style du texte', 'sty');
  await shot('style-texte', '[data-shot=sty]', 700);
  await page.click('.section:has-text("Style du texte") .action:has-text("Fermer l\'éditeur")');

  // Express : le style choisi, les vérifications, puis le compte rendu du clip.
  await page.evaluate(() => { const t = window.RRFXApp.settings().titles; t.mogrt = t.mogrt || 'demo'; });
  await tab('express');
  await page.waitForSelector('.xp-check');
  await page.waitForTimeout(600);
  // Les 15 styles dépliés le temps du choix, puis la vue compacte (le style choisi y reste).
  await page.click('.xp-more:has-text("Tous les styles")');
  await page.click('.xp-style:has-text("Rap énergique")');
  await page.click('.xp-more:has-text("Moins de styles")');
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
  await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:03,200\nBienvenue dans notre nouvel atelier\n\n2\n00:00:03,400 --> 00:00:06,000\nOn vous montre tout en deux minutes');
  await page.click('.section:has(textarea.lyrics) .action:has-text("Mot par mot")');
  await page.fill('.section:has-text("Bandeau") input >> nth=0', 'Camille Martin');
  await page.fill('.section:has-text("Bandeau") input >> nth=1', 'Directrice marketing');
  await close();
  await mark('.section|Départ du .srt', 'sub');
  await shot('parole-sous-titres', '[data-shot=sub]', 500);
  await page.click('button:has-text("Égaliser la voix")');
  await page.waitForSelector('#status.ok:has-text("-14 LUFS")', { timeout: 10000 });
  await page.click('.section:has-text("Chapitres YouTube") .action:has-text("Les sous-titres")');
  await page.click('button:has-text("Créer les chapitres")');
  await page.waitForSelector('.section:has-text("Chapitres YouTube") textarea', { timeout: 10000 });
  await close();
  await mark('.section|Son de la voix', 'son');
  await shot('parole-son', '[data-shot=son]', 500);
  await page.evaluate(() => { document.querySelectorAll('[data-shot]').forEach(e => e.removeAttribute('data-shot')); document.querySelector('[data-sec="euh"]').setAttribute('data-shot', 'euh'); });
  await shot('parole-euh', '[data-shot=euh]', 400);

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
  await page.click('.section:has-text("Cadrage") .action:has-text("Suivre le visage")');
  await page.evaluate(() => { document.querySelectorAll('[data-shot]').forEach(e => e.removeAttribute('data-shot')); const c = Array.from(document.querySelectorAll('.section')).find(e => /Cadrage/.test(e.textContent)); if (c) c.setAttribute('data-shot', 'cad'); });
  await shot('formats-visage', '[data-shot=cad]', 500);
  await page.click('.section:has-text("Cadrage") .action:has-text("Recadrage auto")');

  // Ressources.
  await tab('assets');
  await addFolder(page, pack);
  await page.waitForSelector('#res-grid .card');
  await close();
  await page.click('#res-grid .card:has-text("Teal")');
  await shot('ressources', null, 1500);
  await page.fill('input[aria-label="Lien à importer"]', 'https://www.youtube.com/watch?v=MaVideo123');
  await mark('.section|Importer depuis un lien', 'lk');
  await shot('import-lien', '[data-shot=lk]', 400);

  // Mes effets : bibliothèque et packs de style.
  await page.evaluate(() => window.RRFXApp.services.addItems([
    { type: 'preset', name: 'Zoom drop perso', cat: 'zoom', data: { base: 'zoom-in', params: { frames: 6, intensity: 140 } } },
    { type: 'ramp', name: 'Rampe refrain', data: { points: [{ t: 0, v: 100 }, { t: 0.6, v: 25 }, { t: 1, v: 300 }], frames: 16, segments: 10 } },
    { type: 'look', name: 'Nuit perso', data: { params: { exposure: -0.3, temp: -12 } } },
    { type: 'textStyle', name: 'Jaune shorts', data: { style: { font: 'Montserrat-Black', fill: '#ffd21e', stroke: '#000000', strokeWidth: 6, shadow: true, caps: true } } },
    { type: 'gradient', name: 'Soleil couchant', data: { g: { type: 'linear', angle: 180, colors: ['#ff7e5f', '#2b1055'] }, blend: 13, opacity: 45 } },
    { type: 'palette', name: 'Couleurs de la marque', data: { colors: ['#264653', '#2a9d8f', '#e9c46a', '#e76f51'] } }
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

  // 2.4 : son, parole, formats, textes, historique.
  const idle = () => page.waitForFunction(() => !window.RRFXApp.S.busy, null, { timeout: 30000 });
  const sec = async (t, id, nav) => { await tab(t); if (nav) await page.click('.view.on .sec-nav .action:text-is("' + nav + '")'); await page.evaluate(i => { const el = document.querySelector('.view.on [data-sec="' + i + '"]'); if (el && el.classList.contains('folded')) el.querySelector('.section-title').click(); }, id); };
  await sec('music', 'risers');
  await page.click('.section:has-text("Risers avant les drops") .action:text-is("Trouver les drops")');
  await page.waitForSelector('#status:has-text("drop")', { timeout: 10000 });
  await idle(); await close();
  await shot('risers', '[data-sec=risers]', 500);
  await sec('speech', 'souffle', 'Souffle');
  await shot('respirations', '[data-sec=souffle]', 400);
  await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:03,000\nRegarde ce logo tout neuf\n\n2\n00:00:09,000 --> 00:00:11,000\nEt cette lumière orange\n');
  await sec('speech', 'traduire', 'Traduire');
  await shot('traduction', '[data-sec=traduire]', 400);
  await sec('speech', 'broll', 'Plans de coupe');
  await page.click('.section:has-text("Plans de coupe sur les mots clés") .action:text-is("Voir les correspondances")');
  await shot('plans-de-coupe', '[data-sec=broll]', 400);
  await sec('formats', 'verif', 'Vérifier');
  await page.click('.section:has-text("Vérifier avant export") .action.go');
  await page.waitForSelector('.pf-item', { timeout: 10000 });
  await idle(); await close();
  await shot('verification', '[data-sec=verif]', 400);
  await page.evaluate(() => { const f = window.RRFXApp.settings().formatsPlus; f.min = 5; f.max = 12; f.count = 2; });
  await sec('formats', 'extraits', 'Extraits');
  await page.click('.section:has-text("Extraits pour les réseaux") .action:text-is("Trouver les passages")');
  await page.waitForSelector('.ex-item', { timeout: 15000 });
  await idle(); await close();
  await shot('extraits', '[data-sec=extraits]', 400);
  await sec('formats', 'modeles', 'Modèles');
  await shot('modeles', '[data-sec=modeles]', 400);
  await sec('titles', 'barre');
  await shot('barre-progression', '[data-sec=barre]', 400);
  await page.click('.section:has-text("Barre de progression et compte à rebours") .action:text-is("Poser la barre")');
  await page.waitForSelector('#status.ok', { timeout: 10000 });
  await idle(); await close();
  await page.click('#history');
  await page.waitForSelector('.hist-item', { timeout: 3000 });
  await shot('historique', null, 400);
  await page.keyboard.press('Escape');
  await tab('settings');
  await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.view.on .section-title')).find(x => /Télécommande/.test(x.textContent)); if (t && t.closest('.section').classList.contains('folded')) t.click(); });
  await page.click('label:has-text("Activer la télécommande")');
  await mark('.section|Télécommande', 'tel');
  await shot('telecommande', '[data-shot=tel]', 400);
  await page.click('label:has-text("Activer la télécommande")');

  // 2.5 : montage par le texte, musique à la durée, versions, projet, macros, temps.
  await tab('speech');
  await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:03,000\nBonjour à tous et bienvenue\n\n2\n00:00:03,300 --> 00:00:05,000\neuh non je recommence\n\n3\n00:00:05,200 --> 00:00:08,000\nAujourd\'hui je vous montre notre nouveau café\n\n4\n00:00:08,200 --> 00:00:10,500\nOn a tout refait de A à Z\n\n5\n00:00:10,700 --> 00:00:12,000\nattends je reprends\n\n6\n00:00:12,200 --> 00:00:15,000\nEt le plus beau, c\'est la terrasse\n');
  await sec('speech', 'texte', 'Texte');
  await page.waitForTimeout(900);
  await page.locator('.tx-row').nth(1).locator('.tx-cut').click();
  await page.locator('.tx-row').nth(4).locator('.tx-cut').click();
  await shot('montage-texte', '[data-sec=texte]', 400);
  await sec('music', 'duree');
  await page.click('.section:has-text("Musique à la durée de la vidéo") .action:text-is("Comparer les durées")');
  await page.waitForSelector('.section:has-text("Musique à la durée de la vidéo") .note:has-text("à retirer")', { timeout: 5000 });
  await shot('musique-duree', '[data-sec=duree]', 400);
  await sec('formats', 'versions', 'Versions');
  await page.fill('.section:has-text("Versions de la séquence") input', 'avant retours client');
  await page.click('.section:has-text("Versions de la séquence") .action.go');
  await page.waitForSelector('.ver-item', { timeout: 5000 });
  await idle(); await close();
  await shot('versions', '[data-sec=versions]', 400);
  await sec('assets', 'rangement');
  await page.click('.section:has-text("Ranger le projet") .action:text-is("Voir ce qui sera rangé")');
  await page.waitForSelector('.section:has-text("Ranger le projet") .note:has-text("Vidéos")', { timeout: 5000 });
  await idle(); await close();
  await sec('assets', 'renommer');
  await page.fill('.section:has-text("Renommer en série") input[aria-label="Modèle de nom"]', 'Interview_###');
  await page.click('.section:has-text("Renommer en série") .action:text-is("Aperçu")');
  await page.waitForSelector('.section:has-text("Renommer en série") .note:has-text("→ Interview_001")', { timeout: 5000 });
  await shot('ranger-projet', '[data-sec=rangement]', 400);
  await sec('assets', 'proxies');
  await page.waitForSelector('.section:has-text("Proxies") select', { timeout: 5000 });
  await shot('proxies', '[data-sec=proxies]', 400);
  await page.evaluate(() => {
    const s = window.RRFXApp.settings(), now = new Date(), m = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    s.saved = { total: 1745, months: { [m]: 382 } };
    const day = m + '-' + String(now.getDate()).padStart(2, '0');
    s.timeTrack = { on: true, rate: 45, projects: {
      a: { name: 'Mariage Léa & Hugo', path: '/a.prproj', minutes: 754, lastDay: day, days: { [day]: 96 } },
      b: { name: 'Aftermovie Festival', path: '/b.prproj', minutes: 431, lastDay: m + '-01', days: {} },
      c: { name: 'Interview client', path: '/c.prproj', minutes: 128, lastDay: m + '-01', days: {} } } };
  });
  await tab('settings');
  await page.click('[data-sec=macros] .section-title');
  await page.click('[data-sec=macros] .action:has-text("Interview prête")');
  await page.evaluate(() => { const t = document.querySelector('[data-sec=temps]'); if (t && t.classList.contains('folded')) t.querySelector('.section-title').click(); const m = document.querySelector('[data-sec=macros]'); if (m && m.classList.contains('folded')) m.querySelector('.section-title').click(); });
  await shot('macros', '[data-sec=macros]', 400);
  await shot('temps-gagne', '[data-sec=gagne]', 400);

  // 2.6 : raccords, correcteur, rythme, export en lot, crédits, image de référence, badges.
  await sec('speech', 'raccords', 'Raccords');
  await shot('raccords', '[data-sec=raccords]', 400);
  await page.fill('.section:has(textarea.lyrics) textarea', '1\n00:00:01,000 --> 00:00:01,500\nbonjour  à tous!\n\n2\n00:00:02,000 --> 00:00:03,000\nOn vous montre aujourd\'hui comment on a tout refait dans notre atelier de A à Z\n\n3\n00:00:03,200 --> 00:00:06,000\nEt c\'est parti : première étape.\n');
  await sec('speech', 'correcteur', 'Correcteur');
  await page.click('.section:has-text("Correcteur de sous-titres") .action:text-is("Vérifier les sous-titres")');
  await page.waitForSelector('[data-sec=correcteur] .pf-item');
  await close();
  await shot('correcteur-sous-titres', '[data-sec=correcteur]', 400);
  await sec('formats', 'rythme', 'Rythme');
  await page.click('.section:has-text("Rythme du montage") .action.go');
  await page.waitForSelector('[data-sec=rythme] .note:has-text("médiane")', { timeout: 5000 });
  await idle(); await close();
  await shot('rythme', '[data-sec=rythme]', 500);
  await sec('formats', 'export', 'Export');
  await page.click('[data-sec=export] .action:text-is("Lister les séquences")');
  await page.waitForSelector('[data-sec=export] .seq-list label');
  await page.click('[data-sec=export] .seq-list label >> nth=0');
  await page.click('[data-sec=export] .seq-list label >> nth=2');
  await page.fill('[data-sec=export] input[aria-label="Client"]', 'Nike');
  await shot('export-lot', '[data-sec=export]', 400);
  await sec('music', 'credits');
  await page.click('.section:has-text("Crédits musique et sons") .action:text-is("Lister les sons")');
  await page.waitForSelector('[data-sec=credits] .pf-item');
  await idle(); await close();
  await shot('credits', '[data-sec=credits]', 400);
  await tab('settings');
  await page.evaluate(() => { const s = window.RRFXApp.settings(); s.saved.ops = Math.max(s.saved.ops || 0, 134); s.saved.tools = Array.from({ length: 9 }, (x, i) => 'outil ' + i); window.RRFXApp.switchTab('settings'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.RRFXApp.tips.show(window.RRFXApp.tips.all()[2]));
  await shot('badges', '[data-sec=gagne]', 400);
  await page.evaluate(() => { const b = document.querySelector('.tip-bar'); if (b) b.remove(); });

  // Test de compatibilité (Réglages) et accueil.
  await tab('settings');
  await page.evaluate(() => window.RRFXApp.diagnostic.run());
  await page.waitForSelector('#status.ok:has-text("Tout fonctionne")', { timeout: 8000 });
  await mark('.section|Test de compatibilité', 'tc');
  await shot('test-compatibilite', '[data-shot=tc]', 500);
  await page.evaluate(() => window.RRFXApp.services.welcome());
  await page.waitForSelector('.modal:has-text("Bienvenue")');
  await shot('accueil', null, 500);
  await page.keyboard.press('Escape');
  // Langue : le choix du premier lancement, puis le panneau en anglais.
  await page.evaluate(() => { window.RRFXApp.services.chooseLanguage(); });
  await page.waitForSelector('.modal:has-text("Language")');
  await shot('langue', null, 400);
  await page.click('.modal footer button:has-text("English")');
  await page.evaluate(() => localStorage.setItem('rrfx-lang', 'en'));
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => /Speech/.test((document.getElementById('tabs') || {}).textContent || ''), null, { timeout: 15000 }).catch(async e => { throw new Error('anglais : ' + await page.evaluate(() => document.documentElement.lang + ' ' + document.getElementById('tabs').textContent)); });
  await tab('express');
  await shot('anglais', null, 700);
  await page.evaluate(() => localStorage.setItem('rrfx-lang', 'fr'));

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (errors.length) { console.error('Erreurs :\n- ' + errors.join('\n- ')); process.exit(1); }
})();
