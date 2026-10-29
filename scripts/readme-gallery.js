#!/usr/bin/env node
/*
 * Captures en plus pour le README (plusieurs par outil : réglages, résultat) et les animations
 * de démonstration (Express, silences, montage par le texte). Même cadre que readme-shots.js.
 *
 *   node scripts/readme-gallery.js docs/captures/outils
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
const SRT = '1\n00:00:01,000 --> 00:00:03,000\nBonjour à tous et bienvenue\n\n2\n00:00:03,300 --> 00:00:05,000\neuh non je recommence\n\n3\n00:00:05,200 --> 00:00:08,000\nAujourd\'hui je vous montre notre nouveau café\n\n4\n00:00:08,200 --> 00:00:10,500\nOn a tout refait de A à Z\n\n5\n00:00:10,700 --> 00:00:12,000\nattends je reprends\n\n6\n00:00:12,200 --> 00:00:15,000\nEt le plus beau, c\'est la terrasse\n';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-gallery-'));
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
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: /\/issues\?/.test(r.request().url()) ? JSON.stringify(demo.ISSUES) : '{}' }));
  await page.route('https://github.com/**', r => r.fulfill({ status: 200, body: 'GitHub' }));
  await page.addInitScript(() => { try { localStorage.setItem('rrfx-nowelcome', '1'); } catch (e) { /* stockage indisponible */ } });
  await page.goto(url);
  await goTab('effects');
  await page.waitForSelector('#grid .card');
  await page.waitForTimeout(400);

  const close = async () => { if (await page.isVisible('#status-close')) await page.click('#status-close', { timeout: 2000 }).catch(() => {}); };
  const tab = async t => { await goTab(t); await page.waitForTimeout(250); };
  const idle = () => page.waitForFunction(() => !window.RRFXApp.S.busy, null, { timeout: 30000 });
  const sec = async (t, id, nav) => {
    await tab(t);
    if (nav) await page.click('.view.on .sec-nav .action:text-is("' + nav + '")');
    await page.evaluate(i => { const el = document.querySelector('.view.on [data-sec="' + i + '"]'); if (el && el.classList.contains('folded')) el.querySelector('.section-title').click(); }, id);
  };
  const mark = async (sel, attr) => page.evaluate(([s, a]) => {
    document.querySelectorAll('[data-shot]').forEach(e => e.removeAttribute('data-shot'));
    const [q, txt] = s.split('|'), el = Array.from(document.querySelectorAll('.view.on ' + q)).find(e => e.textContent.includes(txt));
    if (el) el.setAttribute('data-shot', a);
  }, [sel, attr]);
  // La section voulue en haut de la zone de défilement (comme readme-shots.js).
  const place = sel => page.evaluate(s0 => {
    const s = document.getElementById('scroll');
    s.scrollTop = 0;
    if (!s0) return;
    const v = document.querySelector('.view.on');
    if (v) v.style.paddingBottom = '700px';
    const el = document.querySelector(s0);
    const nav = document.querySelector('.view.on .sec-nav');
    if (el) s.scrollTop = el.getBoundingClientRect().top - s.getBoundingClientRect().top - 6 - (nav && nav !== el ? nav.offsetHeight + 4 : 0);
  }, sel || null);
  async function shot(name, selector, settle) {
    await page.waitForTimeout(settle || 500);
    await place(selector);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, name + '.png') });
    await page.evaluate(() => { const v = document.querySelector('.view.on'); if (v) v.style.paddingBottom = ''; });
    console.log(name);
  }
  // Une capture qui échoue n'arrête pas les autres : elle est signalée à la fin.
  // ONLY=nom1,nom2 : seulement ces étapes (pour refaire une capture).
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  async function step(name, fn) {
    if (only && only.indexOf(name) < 0) return;
    try {
      await idle();
      if (await page.isVisible('.modal')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      await fn();
    } catch (e) { failed.push(name + ' : ' + e.message.split('\n').slice(0, 4).join(' / ')); await page.keyboard.press('Escape').catch(() => {}); await idle().catch(() => {}); }
  }
  // Animation : une image toutes les ~250 ms pendant fn, assemblée en GIF par readme-images.py.
  async function film(name, fn) {
    const dir = path.join(tmp, 'gif-' + name);
    fs.mkdirSync(dir);
    let n = 0, on = true;
    const grab = async () => { while (on) { await page.screenshot({ path: path.join(dir, String(n++).padStart(3, '0') + '.png') }).catch(() => {}); await page.waitForTimeout(180); } };
    const loop = grab();
    try { await fn(); } finally { on = false; await loop; }
    const gifDir = path.join(out, '..', 'animations', name);
    fs.rmSync(gifDir, { recursive: true, force: true });
    fs.mkdirSync(gifDir, { recursive: true });
    fs.readdirSync(dir).forEach(f => fs.copyFileSync(path.join(dir, f), path.join(gifDir, f)));
    console.log('animation ' + name + ' (' + n + ' images)');
  }

  // Bibliothèque d'exemple (couleurs de la marque, styles).
  await page.evaluate(() => window.RRFXApp.services.addItems([
    { type: 'palette', name: 'Couleurs de la marque', data: { colors: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'] } },
    { type: 'textStyle', name: 'Jaune shorts', data: { style: { font: 'Montserrat-Black', fill: '#ffd21e', stroke: '#000000', strokeWidth: 6, shadow: true, caps: true } } }
  ]));

  // La musique d'exemple, pour Express et les outils de l'onglet Musique.
  await tab('music');
  const [chooser0] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action:has-text("Choisir un fichier")')]);
  await chooser0.setFiles(music);
  await page.waitForSelector('#status.ok:has-text("Musique analysée")', { timeout: 15000 });
  await close();

  // ------------------------------------------------------------------ animations
  await step('animation express', async () => {
    await page.evaluate(() => { const t = window.RRFXApp.settings().titles; t.mogrt = t.mogrt || 'demo'; });
    await tab('express');
    await page.waitForSelector('.xp-check');
    await page.waitForTimeout(500);
    await close();
    await film('express', async () => {
      await page.waitForTimeout(700);
      for (const s of ['Interview', 'Face cam', 'Reels dynamique']) { await page.click('.xp-style:has-text("' + s + '")'); await page.waitForTimeout(650); }
      await page.click('#cta');
      await page.waitForFunction(() => /prêt|revoir/.test(document.getElementById('status-title').textContent), null, { timeout: 60000 });
      await page.waitForTimeout(400);
      await mark('.section|Dernier montage express', 'rp');
      await place('[data-shot=rp]');
      await page.waitForTimeout(1800);
    });
  });
  await step('animation silences', async () => {
    await tab('speech');
    await page.evaluate(() => { document.getElementById('scroll').scrollTop = 0; });
    await close();
    await film('silences', async () => {
      await page.waitForTimeout(600);
      await page.click('[data-sec=silences] button:has-text("Analyser")');
      await page.waitForSelector('#status.ok:has-text("silences trouvés")', { timeout: 10000 });
      await page.waitForTimeout(500);
      await place('[data-sec=silences]');
      await page.waitForTimeout(1200);
      await page.click('[data-sec=silences] .action.go');
      await idle();
      await page.waitForTimeout(1600);
    });
    await shot('silences-resultat', '[data-sec=silences]', 200);
  });
  await step('animation texte', async () => {
    await page.fill('[data-sec=soustitres] textarea', SRT);
    await sec('speech', 'texte', 'Texte');
    await page.waitForTimeout(900);
    await close();
    await place('[data-sec=texte]');
    await film('texte', async () => {
      await page.waitForTimeout(700);
      await page.locator('.tx-row').nth(3).click();
      await page.waitForTimeout(500);
      await page.locator('.tx-row').nth(1).locator('.tx-cut').click();
      await page.waitForTimeout(600);
      await page.locator('.tx-row').nth(4).locator('.tx-cut').click();
      await page.waitForTimeout(600);
      await page.click('[data-sec=texte] .action.go');
      await idle();
      await page.waitForTimeout(1600);
    });
    await page.click('[data-sec=texte] .action:has-text("Tout rétablir")').catch(() => {});
  });

  // ------------------------------------------------------------------ Express
  await step('express-etapes', async () => {
    await tab('express');
    await close();
    await mark('.section|3. Étapes', 'et');
    await shot('express-etapes', '[data-shot=et]');
  });

  // ------------------------------------------------------------------ Parole
  await step('zoom-visage-parole', async () => {
    await sec('speech', 'visage', 'Visage');
    await close();
    await shot('zoom-visage-parole', '[data-sec=visage]');
  });
  await step('euh-resultat', async () => {
    await sec('speech', 'euh', 'Euh');
    await page.click('[data-sec=euh] .action.go');
    await idle();
    await shot('euh-resultat', '[data-sec=euh]');
  });
  await step('texte', async () => {
    await page.fill('[data-sec=soustitres] textarea', SRT);
    await sec('speech', 'texte', 'Texte');
    await page.waitForTimeout(900);
    await page.click('[data-sec=texte] .action:has-text("Barrer les prises ratées")');
    await page.waitForTimeout(400);
    await close();
    await shot('texte-prises', '[data-sec=texte]');
    await page.click('[data-sec=texte] .action:has-text("Tout rétablir")').catch(() => {});
    await page.fill('[data-sec=texte] input', 'refait');
    await shot('texte-recherche', '[data-sec=texte]');
    await page.fill('[data-sec=texte] input', '');
  });
  await step('mots-cles', async () => {
    await sec('speech', 'soustitres', 'Sous-titres');
    await page.click('[data-sec=soustitres] .action:has-text("Mot par mot")').catch(() => {});
    await close();
    await mark('.row|Mots clés', 'mk');
    await shot('mots-cles', '[data-shot=mk]');
  });
  await step('bandeau', async () => {
    await sec('speech', 'bandeau', 'Bandeau');
    await page.fill('[data-sec=bandeau] input >> nth=0', 'Camille Martin');
    await page.fill('[data-sec=bandeau] input >> nth=1', 'Directrice marketing');
    await close();
    await shot('bandeau', '[data-sec=bandeau]');
  });
  await step('chapitres', async () => {
    await sec('speech', 'chapitres', 'Chapitres');
    await page.click('[data-sec=chapitres] .action:has-text("Les sous-titres")');
    await page.click('[data-sec=chapitres] .action:has-text("Créer les chapitres")');
    await page.waitForSelector('[data-sec=chapitres] textarea', { timeout: 10000 });
    await idle(); await close();
    await shot('chapitres', '[data-sec=chapitres]');
  });
  await step('raccords', async () => {
    await sec('speech', 'raccords', 'Raccords');
    await page.click('[data-sec=raccords] .action:has-text("L-cut")');
    await page.click('[data-sec=raccords] .action:text-is("Poser les raccords")');
    await idle();
    await shot('raccords-poses', '[data-sec=raccords]');
    await page.click('[data-sec=raccords] .action:has-text("J-cut")');
    await page.click('[data-sec=raccords] .action:has-text("Recaler les coupes")');
    await idle();
    await shot('coupes-blancs', '[data-sec=raccords]');
  });
  await step('correcteur', async () => {
    await page.fill('[data-sec=soustitres] textarea', '1\n00:00:01,000 --> 00:00:01,500\nbonjour  à tous!\n\n2\n00:00:02,000 --> 00:00:03,000\nOn vous montre aujourd\'hui comment on a tout refait dans notre atelier de A à Z\n\n3\n00:00:03,200 --> 00:00:06,000\nEt c\'est parti : première étape.\n');
    await sec('speech', 'correcteur', 'Correcteur');
    await page.click('[data-sec=correcteur] .action:text-is("Tout corriger")');
    await page.waitForTimeout(300);
    await shot('correcteur-corrige', '[data-sec=correcteur]');
  });

  // ------------------------------------------------------------------ Musique
  await step('musique', async () => {
    await tab('music');
    await close();
    await mark('.section|Synchroniser le son', 'sy');
    await shot('synchro', '[data-shot=sy]');
    await mark('.section|Volume et intensité', 'vo');
    await shot('volume-intensite', '[data-shot=vo]');
  });
  await step('musique-duree-faite', async () => {
    await sec('music', 'duree');
    await page.click('[data-sec=duree] .action:text-is("Comparer les durées")');
    await page.waitForSelector('[data-sec=duree] .note:has-text("à retirer")', { timeout: 5000 });
    await page.click('[data-sec=duree] .action:text-is("Ajuster la musique")');
    await idle();
    await shot('musique-duree-faite', '[data-sec=duree]');
  });
  await step('reverb', async () => {
    await sec('music', 'tail');
    await close();
    await shot('reverb', '[data-sec=tail]');
  });

  // ------------------------------------------------------------------ Effets et rampes
  await step('effets', async () => {
    await tab('effects');
    await page.click('#grid .card:has-text("Zoom rotation")');
    await close();
    await mark('.section|Paramètres', 'pa');
    await shot('effets-reglages', '[data-shot=pa]');
    await page.click('#cta');
    await idle();
    await shot('effets-appliques', null);
  });
  await step('rampe-reglages', async () => {
    await tab('ramp');
    await close();
    await mark('.section|Réglages', 'rg');
    await shot('rampe-reglages', '[data-shot=rg]');
  });

  // ------------------------------------------------------------------ Couleur
  await step('couleur', async () => {
    await tab('color');
    await page.waitForSelector('.lr-look');
    await close();
    await shot('couleur-looks', '.lr-panel:has(.lr-look)');
    const open = async t => page.evaluate(x => { const hd = Array.from(document.querySelectorAll('.view.on .lr-head')).find(e => e.textContent.includes(x)); if (hd && hd.closest('.lr-panel').classList.contains('closed')) hd.click(); }, t);
    await open('Étalonnage des couleurs');
    await page.click('.lr-panel:has-text("Étalonnage des couleurs") .action:text-is("3 roues")');
    await mark('.lr-panel|Étalonnage des couleurs', 'ro');
    await shot('couleur-roues', '[data-shot=ro]', 700);
    await open('Mélangeur de couleurs');
    await mark('.lr-panel|Mélangeur de couleurs', 'mx');
    await shot('couleur-melangeur', '[data-shot=mx]', 600);
  });
  await step('raccord-image', async () => {
    // Une « image de film » : coucher de soleil orangé fabriqué dans la page.
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d'), sky = g.createLinearGradient(0, 0, 0, 360);
      sky.addColorStop(0, '#1d2b4f'); sky.addColorStop(0.55, '#e0703a'); sky.addColorStop(1, '#3a1d18');
      g.fillStyle = sky; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#ffcf7a'; g.beginPath(); g.arc(420, 230, 46, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#20120f'; g.beginPath(); g.moveTo(0, 290); g.lineTo(180, 240); g.lineTo(330, 280); g.lineTo(520, 250); g.lineTo(640, 275); g.lineTo(640, 360); g.lineTo(0, 360); g.fill();
      return c.toDataURL('image/png').split(',')[1];
    });
    const file = path.join(tmp, 'Blade Runner 2049 - plan 12.png');
    fs.writeFileSync(file, Buffer.from(png, 'base64'));
    await page.evaluate(() => { const hd = Array.from(document.querySelectorAll('.view.on .lr-head')).find(e => e.textContent.includes('Expo, balance et raccord')); if (hd && hd.closest('.lr-panel').classList.contains('closed')) hd.click(); });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.action:has-text("ou une image")')]);
    await chooser.setFiles(file);
    await page.waitForSelector('.fix-ref img', { timeout: 10000 });
    await page.click('.action:has-text("Raccorder la sélection")');
    await page.waitForSelector('.fix-preview canvas', { timeout: 15000 });
    await idle(); await close();
    await shot('raccord-image', '.lr-panel:has(.fix-ref)', 600);
  });

  // ------------------------------------------------------------------ Textes
  await step('mes-couleurs', async () => {
    await tab('titles');
    await close();
    await mark('.section|Mes couleurs', 'mc');
    await shot('mes-couleurs', '[data-shot=mc]');
  });

  // ------------------------------------------------------------------ Formats et livraison
  await step('extraits-crees', async () => {
    await sec('formats', 'extraits', 'Extraits');
    await page.evaluate(() => { const f = window.RRFXApp.settings().formatsPlus; f.min = 5; f.max = 12; f.count = 2; window.RRFXApp.switchTab('formats'); });
    await sec('formats', 'extraits', 'Extraits');
    await page.click('[data-sec=extraits] .action:text-is("Trouver les passages")');
    await page.waitForSelector('.ex-item', { timeout: 15000 });
    await idle();
    await page.click('[data-sec=extraits] .action:text-is("Créer les extraits")');
    await page.waitForSelector('#status.ok:has-text("extrait")', { timeout: 30000 });
    await idle();
    await shot('extraits-crees', '[data-sec=extraits]');
  });
  await step('lot', async () => {
    await sec('formats', 'export', 'Export');
    await page.selectOption('[data-sec=export] select >> nth=0', 'applyLook');
    await page.click('[data-sec=export] .action:text-is("Lister les séquences")');
    await page.waitForTimeout(400);
    await page.click('[data-sec=export] .seq-list label >> nth=0').catch(() => {});
    await page.click('[data-sec=export] .seq-list label >> nth=2').catch(() => {});
    await close();
    await shot('plusieurs-sequences', '[data-sec=export]');
    await page.selectOption('[data-sec=export] select >> nth=0', 'export');
  });
  await step('rythme', async () => {
    await sec('formats', 'rythme', 'Rythme');
    await page.click('[data-sec=rythme] .action.go');
    await page.waitForSelector('[data-sec=rythme] .note:has-text("médiane")', { timeout: 5000 });
    await idle(); await close();
    await shot('rythme', '[data-sec=rythme]');
    await page.click('[data-sec=rythme] .action:text-is("Marquer les plans longs")');
    await idle();
    await shot('rythme-marques', '[data-sec=rythme]');
  });

  // ------------------------------------------------------------------ Projet et ressources
  await step('ressources', async () => {
    await tab('assets');
    await addFolder(page, pack);
    await page.waitForSelector('#res-grid .card');
    await close();
    await page.click('.chips .action:has-text("Sons")');
    await page.waitForTimeout(500);
    await shot('ressources-sons', '#res-grid', 900);
    await page.click('.chips .action:has-text("Polices")');
    await page.click('#res-grid .card >> nth=0').catch(() => {});
    await shot('ressources-polices', '#res-grid', 1200);
    await page.click('.chips .action:has-text("Tout")');
  });
  await step('surveilles', async () => {
    await page.evaluate(() => {
      const s = window.RRFXApp.settings();
      s.watch = [{ dir: '/Volumes/SD_A7III/DCIM/100MSDCF', bin: 'Rushs/Carte A7 III', on: true, last: Date.now() - 4 * 60000, lastCount: 12, total: 48 }];
    });
    await sec('assets', 'surveilles');
    await close();
    await shot('dossiers-surveilles', '[data-sec=surveilles]');
  });
  await step('proxies', async () => {
    await sec('assets', 'proxies');
    await page.click('[data-sec=proxies] .action:text-is("Tous les rushs vidéo")').catch(() => {});
    await page.click('[data-sec=proxies] .action:text-is("Créer les proxies")');
    await page.waitForTimeout(1600);
    await shot('proxies-en-cours', '[data-sec=proxies]', 200);
    await idle().catch(() => {});
  });
  await step('archive', async () => {
    await sec('assets', 'archive');
    await page.click('[data-sec=archive] .action:text-is("Voir la taille")').catch(() => {});
    await idle(); await close();
    await shot('archive', '[data-sec=archive]');
  });

  // ------------------------------------------------------------------ 2.8 : transcription
  await step('transcription', async () => {
    await page.evaluate(() => { window.RRFXApp.speech.settings().srt = ''; });
    await sec('speech', 'transcrire', 'Transcrire');
    await page.click('[data-sec=transcrire] .action.go');
    await page.waitForSelector('#status.ok:has-text("sous-titres")', { timeout: 10000 });
    await idle();
    await shot('transcription', '[data-sec=transcrire]', 300);
    await page.evaluate(() => { const r = window.RRFXApp.speech.settings(); r.fillerMode = 'markers'; });
    await sec('speech', 'euh', 'Euh');
    await page.click('[data-sec=euh] .action.go');
    await idle();
    await shot('transcription-euh', '[data-sec=euh]', 300);
  });

  // ------------------------------------------------------------------ 2.7 : outils de Premiere, fenêtres
  await step('premiere', async () => {
    await goTab('native');
    await close();
    await shot('premiere-transitions', null, 400);
    await page.click('[data-sec=transitions] .action.go');
    await idle();
    await shot('premiere-transitions-posees', '[data-sec=transitions]', 300);
    await page.evaluate(() => { const t = document.querySelector('[data-sec=autres]'); if (t && t.classList.contains('folded')) t.querySelector('.section-title').click(); });
    await page.click('[data-sec=scenes] .action.go');
    await idle();
    await shot('premiere-plans', '[data-sec=scenes]', 300);
  });
  await step('fenetres', async () => {
    await goTab('speech');
    await close();
    await page.click('#open-windows');
    await page.waitForSelector('.modal .win-spaces');
    await shot('fenetres', null, 300);
    await page.click('.modal .win-spaces .action:text-is("Interview et YouTube")');
    await page.click('.modal footer .cta');
    await goTab('formats');
    await close();
    await shot('espace-interview', null, 500);
    await page.click('#open-windows');
    await page.click('.modal footer button:has-text("Tout afficher")');
  });
  await step('reglages-themes', async () => {
    await goTab('settings');
    await close();
    await shot('reglages-themes', null, 400);
  });

  // ------------------------------------------------------------------ Réglages
  await step('reglages', async () => {
    await tab('settings');
    const unfold = async t => {
      await page.evaluate(x => { const el = Array.from(document.querySelectorAll('.view.on .section')).find(e => e.querySelector('.section-title') && e.querySelector('.section-title').textContent.includes(x)); if (el && el.classList.contains('folded')) el.querySelector('.section-title').click(); }, t);
      await page.waitForTimeout(250);
    };
    await unfold('Macros');
    await page.click('[data-sec=macros] .action:has-text("Interview prête")');
    await page.click('[data-sec=macros] .action:text-is("Modifier") >> nth=0');
    await page.waitForTimeout(300);
    await close();
    await shot('macro-edition', '[data-sec=macros]');
    await page.click('.modal .button-secondary, .modal button:has-text("Annuler")');
    await page.waitForTimeout(300);
    await unfold('Raccourcis clavier');
    await mark('.section|Raccourcis clavier', 'rc');
    await shot('raccourcis', '[data-shot=rc]');
    await unfold('Synchro entre ordinateurs');
    await mark('.section|Synchro entre ordinateurs', 'sn');
    await shot('synchro-ordinateurs', '[data-shot=sn]');
  });
  await step('temps-passe', async () => {
    await page.evaluate(() => {
      const s = window.RRFXApp.settings(), now = new Date(), m = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      const day = m + '-' + String(now.getDate()).padStart(2, '0');
      s.timeTrack = { on: true, rate: 45, projects: {
        a: { name: 'Mariage Léa & Hugo', path: '/a.prproj', minutes: 754, lastDay: day, days: { [day]: 96 } },
        b: { name: 'Aftermovie Festival', path: '/b.prproj', minutes: 431, lastDay: m + '-01', days: {} },
        c: { name: 'Interview client', path: '/c.prproj', minutes: 128, lastDay: m + '-01', days: {} } } };
      window.RRFXApp.switchTab('settings');
    });
    await page.evaluate(() => { const t = document.querySelector('[data-sec=temps]'); if (t && t.classList.contains('folded')) t.querySelector('.section-title').click(); });
    await close();
    await shot('temps-passe', '[data-sec=temps]');
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed.length) console.error('Captures ratées :\n- ' + failed.join('\n- '));
  if (errors.length) console.error('Erreurs :\n- ' + errors.join('\n- '));
  if (failed.length || errors.length) process.exit(1);
})();
