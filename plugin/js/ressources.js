/* RR FX — onglet Ressources : les dossiers du disque liés au plugin (effets, SFX, polices,
   LUTs, titres, overlays…), indexés, classés, avec aperçus et actions directes vers Premiere. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const A = root.RRFXAssets, { Store, Host, Media, Pv, Share } = app;
    const { h, hotText, actionGroup, picker, row, section, fitCanvas, css } = app.UI;

    const INDEX_FILE = 'ressources-index.json';
    const PAGE = 60;
    const STALE_MS = 60 * 60 * 1000; // index relu en arrière-plan au-delà d'une heure

    const DEFAULTS = { roots: [], type: 'all', folder: '', search: '', sort: 'name', favs: [], favOnly: false, imageDur: 5 };
    const st = () => {
      const s = app.settings();
      if (!s.assets || typeof s.assets !== 'object') s.assets = {};
      Object.keys(DEFAULTS).forEach(k => { if (!(k in s.assets)) s.assets[k] = Array.isArray(DEFAULTS[k]) ? [] : DEFAULTS[k]; });
      return s.assets;
    };

    // index : { racine: { files, truncated, scanned } } ; list : entrées ; browser : dossiers du mode démo.
    const R = { index: null, list: [], filtered: [], shown: PAGE, sel: null, loaded: false, view: null, observer: null, audio: null, playing: null, lumetri: null };
    const sep = () => (Store.path ? Store.path.sep : '/');

    function loadIndex() {
      if (R.loaded) return;
      R.loaded = true;
      const saved = Store.readJSON(INDEX_FILE);
      R.index = {};
      st().roots.forEach(r => { if (saved && saved.roots && saved.roots[r]) R.index[r] = saved.roots[r]; });
      rebuild();
    }
    function saveIndex() {
      const roots = {};
      Object.keys(R.index).forEach(r => { if (!R.index[r].browser) roots[r] = { files: R.index[r].files, truncated: R.index[r].truncated, scanned: R.index[r].scanned }; });
      try { Store.writeJSON(INDEX_FILE, { version: 1, roots }); } catch (e) { app.log('Index des ressources non enregistré : ' + app.errorMessage(e), 'warn'); }
    }
    function rebuild() {
      R.list = A.entries(R.index, sep());
      const ids = new Set(R.list.map(e => e.id));
      if (R.sel && !ids.has(R.sel.id)) R.sel = null;
      refilter();
    }
    function refilter() {
      const s = st();
      R.filtered = A.filter(R.list, { type: s.type, folder: s.folder, search: s.search, sort: s.sort, favOnly: s.favOnly, favs: new Set(s.favs) });
      R.shown = PAGE;
    }

    // ---------------------------------------------------------------- dossiers liés

    function scanRoots(roots, label) {
      return app.runTask(label || 'Indexation des ressources', async () => {
        let total = 0, cut = 0;
        for (let i = 0; i < roots.length; i++) {
          if (app.S.cancel) break;
          const r = roots[i];
          app.status.phase('Lecture de « ' + r.split(/[\\/]/).filter(Boolean).pop() + ' »');
          if (!Store.fs.existsSync(r)) {
            // Disque débranché : on garde l'ancien index, signalé dans la liste.
            app.log('Dossier introuvable (disque débranché ?) : ' + r, 'warn');
            if (R.index[r]) R.index[r].missing = true;
            continue;
          }
          const res = await A.scanFolder(Store.fs, Store.path, r, {
            onProgress: n => app.status.progress(0, 1, n + ' fichiers'),
            shouldStop: () => app.S.cancel
          });
          if (app.S.cancel) break;
          R.index[r] = res;
          total += res.files.length;
          if (res.truncated) cut++;
        }
        saveIndex();
        rebuild();
        render();
        const c = A.counts(R.list);
        const detail = A.TYPES.filter(t => c[t.id]).map(t => c[t.id] + ' ' + t.label.toLowerCase()).join(' · ');
        app.log('Ressources : ' + total + ' fichiers indexés' + (cut ? ' (limite de 50 000 atteinte)' : ''), cut ? 'warn' : 'ok');
        if (app.S.cancel) return { kind: 'warn', title: 'Indexation arrêtée', detail: 'Clique sur « Actualiser » pour la reprendre.' };
        return { kind: cut ? 'warn' : 'ok', title: app.plural(total, 'ressource') + ' indexée' + (total > 1 ? 's' : ''), detail: detail || 'Aucun fichier reconnu (vidéos, images, sons, LUTs, polices, .mogrt, presets).' };
      }, true);
    }

    function linkFolder() {
      if (!Store.fs) return linkBrowserFolder();
      const dirs = Store.pickFiles('Lier un dossier de ressources (effets, SFX, polices, LUTs…)', [], true);
      if (!dirs || !dirs.length) return;
      const s = st(), fresh = dirs.filter(d => s.roots.indexOf(d) < 0);
      if (!fresh.length) return app.status.finish('warn', 'Déjà lié', dirs[0]);
      s.roots = s.roots.concat(fresh);
      app.persist();
      scanRoots(fresh, 'Indexation de « ' + fresh[0].split(/[\\/]/).filter(Boolean).pop() + ' »');
    }

    // Hors de Premiere (démo) : un dossier choisi dans le navigateur, le temps de la session.
    function linkBrowserFolder() {
      const input = h('input', { type: 'file', class: 'hidden', webkitdirectory: true, multiple: true });
      input.addEventListener('change', () => {
        addBrowserFiles(input.files);
        // Le champ reste dans la page : ses fichiers restent lisibles pour les aperçus.
        if (R.browserInput) R.browserInput.remove();
        R.browserInput = input;
      });
      document.body.appendChild(input);
      input.click();
    }

    // Fichiers d'un dossier (File avec webkitRelativePath) : sélecteur ou glisser-déposer.
    function addBrowserFiles(files) {
      loadIndex();
      const idx = A.fromFileList(files);
      Object.keys(idx).forEach(k => { idx[k].browser = true; R.index[k] = idx[k]; if (st().roots.indexOf(k) < 0) st().roots.push(k); });
      rebuild();
      render();
      app.status.finish('ok', app.plural(R.list.length, 'ressource') + ' trouvée' + (R.list.length > 1 ? 's' : ''), 'Mode démo : le dossier est lu par le navigateur, le temps de la session.');
    }

    function unlink(r) {
      const s = st();
      s.roots = s.roots.filter(x => x !== r);
      if (s.folder && (s.folder === r || s.folder.indexOf(r + '|') === 0)) s.folder = '';
      delete R.index[r];
      app.persist();
      saveIndex();
      rebuild();
      render();
    }

    // ---------------------------------------------------------------- fichiers

    const urls = new Map();
    // Adresse lisible par le panneau (file:// dans Premiere, blob: en démo).
    function urlOf(e) {
      if (!e.file) return app.fileURL(e.path);
      if (!urls.has(e.id)) urls.set(e.id, URL.createObjectURL(e.file));
      return urls.get(e.id);
    }
    async function textOf(e) {
      if (e.file) return e.file.text();
      return Store.fs.readFileSync(e.path, 'utf8');
    }
    const ioOf = e => (e.file ? Media.blobIO(e.file) : Media.nodeIO(Store.fs, e.path));

    // Forme d'onde d'un son court (les 12 premières secondes).
    async function soundPeaks(e, n, maxBytes) {
      const io = ioOf(e);
      let x, sr;
      try {
        const info = await Media.probe(io);
        if (info.kind === 'wav' || (info.kind === 'mp4' && info.codec === 'pcm')) {
          const w = await Media.readWindow(io, info, 0, Math.min(12, info.duration));
          x = w.samples; sr = w.sampleRate;
        } else {
          if (e.size > (maxBytes || 25 * 1024 * 1024)) return null;
          const Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
          const bytes = await io.read(0, await io.size());
          const buf = await new Ctx(1, 1, 44100).decodeAudioData(bytes.slice().buffer);
          x = buf.getChannelData(0).subarray(0, Math.min(buf.length, buf.sampleRate * 12)); sr = buf.sampleRate;
        }
      } finally {
        if (io.close) io.close();
      }
      const out = new Float32Array(n), step = Math.max(1, Math.floor(x.length / n));
      let max = 1e-6;
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = i * step, end = Math.min(x.length, j + step); j < end; j += 4) m = Math.max(m, Math.abs(x[j]));
        out[i] = m;
        max = Math.max(max, m);
      }
      for (let i = 0; i < n; i++) out[i] /= max;
      return { peaks: out, duration: x.length / sr };
    }

    const fonts = new Map();
    // Police chargée dans le panneau pour son aperçu (nom de famille interne).
    async function fontFamily(e) {
      if (!fonts.has(e.id)) {
        const fam = 'rrfx-font-' + fonts.size;
        fonts.set(e.id, (async () => {
          const face = new FontFace(fam, 'url("' + urlOf(e) + '")');
          await face.load();
          document.fonts.add(face);
          return fam;
        })());
      }
      return fonts.get(e.id);
    }

    const luts = new Map();
    async function lutOf(e) {
      if (!luts.has(e.id)) luts.set(e.id, textOf(e).then(t => A.parseCube(t)));
      return luts.get(e.id);
    }
    // Une image (plan de test ou vraie image) passée dans la LUT.
    function gradeOnto(canvas, img, lut) {
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (!lut) return;
      const d = g.getImageData(0, 0, canvas.width, canvas.height);
      A.applyLut(d.data, lut);
      g.putImageData(d, 0, 0);
    }

    function loadImage(src) {
      return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image illisible')); i.src = src; });
    }
    function videoFrame(src) {
      return new Promise((res, rej) => {
        const v = document.createElement('video');
        const done = (ok, val) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); (ok ? res : rej)(val); };
        const timer = setTimeout(() => done(false, new Error('lecture trop longue')), 5000);
        v.muted = true; v.preload = 'auto';
        v.addEventListener('loadedmetadata', () => { try { v.currentTime = Math.min(1, (v.duration || 2) * 0.3); } catch (err) { done(false, err); } }, { once: true });
        v.addEventListener('seeked', () => {
          const c = document.createElement('canvas');
          c.width = 320; c.height = Math.round(320 * (v.videoHeight || 9) / (v.videoWidth || 16));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          done(true, { canvas: c, duration: v.duration, w: v.videoWidth, h: v.videoHeight });
        }, { once: true });
        v.addEventListener('error', () => done(false, new Error('format non lu par le panneau')), { once: true });
        v.src = src;
      });
    }
    const BROWSER_IMAGES = /^(png|jpe?g|gif|webp|bmp)$/;

    // ---------------------------------------------------------------- vignettes

    const thumbs = new Map(); // id → canvas dessiné
    let queue = [], running = 0;
    function enqueue(job) {
      queue.push(job);
      pump();
    }
    function pump() {
      while (running < 3 && queue.length) {
        const job = queue.shift();
        if (!job.card.isConnected) continue;
        running++;
        job.run().catch(() => {}).then(() => { running--; pump(); });
      }
    }

    function iconThumb(cv, e, note) {
      const g = cv.getContext('2d'), t = A.typeById[e.type], W = cv.width, H = cv.height;
      const hue = { video: 210, image: 160, audio: 280, lut: 30, font: 340, mogrt: 190, preset: 50 }[e.type] || 0;
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, 'hsl(' + hue + ',35%,22%)'); grad.addColorStop(1, 'hsl(' + hue + ',30%,12%)');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      g.fillStyle = 'hsla(' + hue + ',70%,80%,0.9)';
      g.font = '600 ' + Math.round(H * 0.34) + 'px ' + css('--font');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t ? t.icon : '?', W / 2, H * 0.44);
      g.font = '600 ' + Math.round(H * 0.13) + 'px ' + css('--font');
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText((note || '.' + e.ext).toUpperCase(), W / 2, H * 0.8);
    }

    function drawPeaks(cv, p, color) {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = p.peaks.length;
      g.fillStyle = '#16131f'; g.fillRect(0, 0, W, H);
      g.fillStyle = color || 'rgba(190,150,255,0.9)';
      for (let i = 0; i < n; i++) {
        const x = Math.floor(i / n * W), w = Math.max(1, Math.floor(W / n) - 1), hh = Math.max(1, p.peaks[i] * H * 0.8);
        g.fillRect(x, (H - hh) / 2, w, hh);
      }
    }

    // Dessine la vignette (une fois par fichier, gardée en mémoire).
    async function drawThumb(cv, e) {
      const W = cv.width, H = cv.height, g = cv.getContext('2d');
      try {
        if (e.type === 'image' && BROWSER_IMAGES.test(e.ext)) {
          const img = await loadImage(urlOf(e));
          const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
          g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
          g.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
        } else if (e.type === 'video') {
          const f = await videoFrame(urlOf(e));
          const k = Math.max(W / f.canvas.width, H / f.canvas.height);
          g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
          g.drawImage(f.canvas, (W - f.canvas.width * k) / 2, (H - f.canvas.height * k) / 2, f.canvas.width * k, f.canvas.height * k);
          e.duration = f.duration;
        } else if (e.type === 'audio') {
          const p = await soundPeaks(e, 80, 8 * 1024 * 1024);
          if (!p) throw new Error('trop gros');
          drawPeaks(cv, p);
          e.duration = p.duration;
        } else if (e.type === 'lut' && e.ext === 'cube') {
          gradeOnto(cv, Pv.shots().A, await lutOf(e));
        } else if (e.type === 'font') {
          const fam = await fontFamily(e);
          g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, W, H);
          g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = Math.round(H * 0.42) + 'px "' + fam + '"';
          g.fillText('Aa', W / 2, H * 0.42);
          g.font = Math.round(H * 0.15) + 'px "' + fam + '"';
          g.fillStyle = 'rgba(255,255,255,0.7)';
          g.fillText('0123 · AbcXyz', W / 2, H * 0.78);
        } else iconThumb(cv, e);
      } catch (err) {
        iconThumb(cv, e);
      }
      const keep = document.createElement('canvas');
      keep.width = W; keep.height = H;
      keep.getContext('2d').drawImage(cv, 0, 0);
      thumbs.set(e.id, keep);
      if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value);
    }

    function observe(card, cv, e) {
      const cached = thumbs.get(e.id);
      if (cached) { cv.getContext('2d').drawImage(cached, 0, 0); return; }
      iconThumb(cv, e, '…');
      if (!R.observer) {
        R.observer = new IntersectionObserver(items => items.forEach(it => {
          if (!it.isIntersecting) return;
          R.observer.unobserve(it.target);
          const job = it.target.rrfxJob;
          if (job) enqueue(job);
        }), { root: document.getElementById('scroll'), rootMargin: '200px' });
      }
      card.rrfxJob = { card, run: () => drawThumb(cv, e) };
      R.observer.observe(card);
    }

    // ---------------------------------------------------------------- actions

    async function times(where) {
      const m = await Host.call('markerList', {});
      if (!m.ok) throw new Error(m.error);
      if (where === 'playhead') return [m.playhead];
      let t = m.markers.map(x => x.t);
      if (m.range) t = t.filter(x => x >= m.range.a - 1e-6 && x <= m.range.b + 1e-6);
      if (!t.length) throw new Error(m.range ? 'Aucun marqueur dans les clips sélectionnés.' : 'Aucun marqueur dans la séquence : pose les temps forts (onglet Musique) ou des marqueurs (touche M).');
      return t;
    }

    function place(e, where) {
      return app.runTask('Pose · ' + e.name, async () => {
        app.status.phase('Position');
        const t = await times(where);
        app.status.phase(t.length > 1 ? 'Pose sur ' + t.length + ' marqueurs' : 'Pose');
        const r = await Host.call('placeAsset', { path: e.path || e.fileName, kind: e.type, name: e.name, times: t, imageDur: st().imageDur });
        if (!r.ok) return { kind: 'error', title: 'Rien n\'a été posé', detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        app.pushHistory({ date: Date.now(), label: e.name + (t.length > 1 ? ' × ' + r.created.length : ''), entries: r.created });
        const where2 = e.type === 'audio' ? 'sur une piste audio libre' : 'au-dessus de tes plans';
        return { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', title: e.name + (r.created.length > 1 ? ' posé ' + r.created.length + ' fois' : ' posé'), detail: where2 + ' · ↶ Annuler le retire.' };
      }, true);
    }

    function importOne(e) {
      return app.runTask('Import · ' + e.name, async () => {
        const r = await Host.call('importAssets', { paths: [e.path || e.fileName] });
        if (!r.ok) return { kind: 'error', title: 'Import impossible', detail: r.error };
        if (r.failed.length) return { kind: 'error', title: 'Import impossible', detail: 'Premiere n\'a pas importé « ' + e.fileName + ' ».' };
        return { kind: 'ok', title: e.name + ' importé', detail: 'Dans le chutier « RR FX Ressources » du panneau Projet.' };
      });
    }

    async function lumetriName() {
      if (R.lumetri) return R.lumetri;
      const r = await Host.call('listEffects', { filter: 'lumetri' });
      R.lumetri = (r.ok && r.names.find(n => /lumetri/i.test(n) && !/preset|préréglage/i.test(n))) || null;
      return R.lumetri;
    }

    // Calque de réglage avec Lumetri sur le clip visé ; le chemin de la LUT est copié.
    function lumetriLayer(e) {
      return app.runTask('Calque Lumetri · ' + e.name, async () => {
        const r = await Host.call('resolve', { placement: 'full', sides: ['post'], frames: 1, target: 'adjustment' });
        if (!r.ok) return { kind: 'error', title: 'Aucun clip visé', detail: r.error };
        const found = await lumetriName();
        const fx = [{ type: 'lumetri', names: (found ? [found] : []).concat(A.LUMETRI_NAMES), props: [] }];
        const name = 'RR FX · LUT ' + e.name;
        const res = await Host.call('apply', { target: 'adjustment', name, targets: r.targets.map(t => Object.assign({}, t, { name, fx })), adjNodeId: app.settings().adjNodeId, refreshAdj: true });
        if (!res.ok) return { kind: 'error', title: 'Calque non posé', detail: res.error };
        if (res.created && res.created.length) app.pushHistory({ date: Date.now(), label: 'LUT · ' + e.name, entries: res.created });
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        const copied = e.path ? await copy(e.path) : false;
        return { kind: res.warnings && res.warnings.length ? 'warn' : 'ok', title: 'Calque Lumetri posé', detail: 'Lumetri > Créatif > Look > Parcourir… et choisis « ' + e.fileName + ' »' + (copied ? ' (chemin copié : colle-le dans la fenêtre).' : '.') + ' Les scripts ne peuvent pas choisir la LUT à ta place.' };
      });
    }

    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
      return Promise.resolve(false);
    }

    async function installLut(e) {
      const dirs = Store.systemDirs();
      if (!dirs) return app.status.finish('warn', 'Disponible dans Premiere', 'L\'installation copie la LUT dans le dossier Adobe de ton ordinateur.');
      try {
        Store.fs.mkdirSync(dirs.luts, { recursive: true });
        Store.fs.copyFileSync(e.path, Store.path.join(dirs.luts, e.fileName));
        app.log('LUT installée : ' + Store.path.join(dirs.luts, e.fileName), 'ok');
        app.status.finish('ok', 'LUT installée : ' + e.name, 'Redémarre Premiere : elle apparaît dans Lumetri > Créatif > Look.');
      } catch (err) {
        app.status.finish('error', 'LUT non installée', app.errorMessage(err));
      }
    }

    async function installFont(e) {
      const dirs = Store.systemDirs();
      if (!dirs) return app.status.finish('warn', 'Disponible dans Premiere', 'L\'installation copie la police dans le dossier des polices de ton ordinateur.');
      const ok = await app.confirmDialog('Installer « ' + e.name + ' » ?', 'La police est copiée dans tes polices (' + dirs.fonts + '). Redémarre Premiere pour la voir dans l\'outil Texte.', 'Installer');
      if (!ok) return;
      try {
        const to = Store.path.join(dirs.fonts, e.fileName);
        Store.fs.mkdirSync(dirs.fonts, { recursive: true });
        Store.fs.copyFileSync(e.path, to);
        if (dirs.win) {
          // Windows : une police d'utilisateur doit aussi être déclarée dans le registre.
          const r = await Store.execFile('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', '/v', e.name + (e.ext === 'otf' ? ' (OpenType)' : ' (TrueType)'), '/t', 'REG_SZ', '/d', to, '/f']);
          if (!r.ok) throw new Error('registre : ' + r.out);
        }
        app.log('Police installée : ' + to, 'ok');
        app.status.finish('ok', 'Police installée : ' + e.name, 'Redémarre Premiere pour l\'utiliser.');
      } catch (err) {
        app.status.finish('error', 'Police non installée', app.errorMessage(err));
      }
    }

    async function addPresetFile(e) {
      let data;
      try { data = JSON.parse(await textOf(e)); } catch (err) { return app.status.finish('error', 'Fichier illisible', app.errorMessage(err)); }
      const n = app.services.addItems(data && Array.isArray(data.items) ? Share.clean(data.items) : []);
      if (n) app.status.finish('ok', app.plural(n, 'effet ajouté', 'effets ajoutés'), 'Dans « Mes effets ».');
      else app.status.finish('warn', 'Rien d\'ajouté', 'Aucun effet RR FX dans ce fichier.');
    }

    function useAsTitle(e) {
      const t = app.settings().titles || (app.settings().titles = {});
      t.mogrt = e.path || e.fileName;
      app.persist();
      app.switchTab('titles');
      app.status.finish('ok', 'Modèle choisi : ' + e.name, 'Écris tes paroles, puis « Poser les textes ».');
    }

    function reveal(e) {
      if (!e.path || !Store.reveal(e.path)) app.status.finish('warn', 'Disponible dans Premiere', e.rel);
    }

    function stopSound() {
      if (R.audio) { R.audio.pause(); R.audio = null; }
      R.playing = null;
    }
    function playSound(e, btn) {
      if (R.playing === e.id) { stopSound(); if (btn) btn.textContent = '▶ Écouter'; return; }
      stopSound();
      R.audio = new Audio(urlOf(e));
      R.playing = e.id;
      R.audio.addEventListener('ended', () => { stopSound(); if (btn && btn.isConnected) btn.textContent = '▶ Écouter'; });
      const p = R.audio.play();
      if (p && p.catch) p.catch(() => { app.status.finish('warn', 'Lecture impossible', 'Ce format n\'est pas lu par le panneau.'); stopSound(); });
      if (btn) btn.textContent = '■ Stop';
    }

    // Action du bouton principal pour l'élément choisi.
    function mainAction(e) {
      switch (e.type) {
        case 'audio': return { label: 'Poser le son à la tête de lecture', run: () => place(e, 'playhead') };
        case 'video': case 'image': return { label: 'Poser à la tête de lecture', run: () => place(e, 'playhead') };
        case 'mogrt': return { label: 'Poser le titre à la tête de lecture', run: () => place(e, 'playhead') };
        case 'lut': return { label: 'Calque de réglage Lumetri', run: () => lumetriLayer(e) };
        case 'font': return { label: 'Installer la police', run: () => installFont(e) };
        default: return /\.(rrfx|cutfx)\.json$/i.test(e.fileName) ? { label: 'Ajouter à Mes effets', run: () => addPresetFile(e) } : { label: 'Afficher dans le dossier', run: () => reveal(e) };
      }
    }

    // ---------------------------------------------------------------- interface

    function btn(label, fn, cls, title) {
      const b = h('button', { class: 'action' + (cls ? ' ' + cls : ''), title }, label);
      b.addEventListener('click', fn);
      return b;
    }

    function renderRoots() {
      const s = st(), box = h('div', { class: 'res-roots' });
      s.roots.forEach(r => {
        const idx = R.index[r], name = r.split(/[\\/]/).filter(Boolean).pop() || r;
        const meta = idx && idx.missing ? '⚠ introuvable : disque débranché ? (index gardé)' : idx ? app.plural(idx.files.length, 'fichier') + (idx.truncated ? ' (limite atteinte)' : '') + (idx.browser ? ' · session' : ' · ' + new Date(idx.scanned).toLocaleDateString('fr-FR')) : 'pas encore indexé';
        box.appendChild(h('div', { class: 'list-item' },
          h('span', { class: 'li-icon' }, '▤'),
          h('div', { class: 'li-text', title: r }, h('div', { class: 'li-name' }, name), h('div', { class: 'li-meta' }, meta)),
          h('div', { class: 'li-actions' }, btn('✕', () => unlink(r), 'quiet danger', 'Délier (les fichiers ne sont pas touchés)'))));
      });
      return box;
    }

    function renderFilters() {
      const s = st(), c = A.counts(R.list);
      const search = h('input', { class: 'textfield', placeholder: 'Rechercher (nom, dossier, type…)', value: s.search, spellcheck: 'false' });
      let timer = 0;
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { s.search = search.value; app.persist(); refilter(); renderGrid(); }, 120); });
      const fav = btn('★', () => { s.favOnly = !s.favOnly; app.persist(); refilter(); render(); }, 'icon' + (s.favOnly ? ' selected on' : ''), 'Favoris uniquement');
      const chips = h('div', { class: 'chips' });
      [{ id: 'all', label: 'Tout' }].concat(A.TYPES).forEach(t => {
        if (t.id !== 'all' && !c[t.id]) return;
        const b = h('button', { class: 'action' + (s.type === t.id ? ' selected' : '') }, t.label + ' ', h('span', { class: 'count' }, String(c[t.id])));
        b.addEventListener('click', () => { s.type = t.id; app.persist(); refilter(); render(); });
        chips.appendChild(b);
      });
      const fl = A.folders(R.list).filter(f => f.depth <= 4).slice(0, 600);
      const folderPick = picker([{ v: '', label: 'Tous les dossiers' }].concat(fl.map(f => ({ v: f.key, label: '  '.repeat(f.depth) + f.label.split(' / ').pop() + ' (' + f.n + ')' }))), s.folder, v => { s.folder = v; app.persist(); refilter(); renderGrid(); });
      const sortPick = picker([{ v: 'name', label: 'Par dossier et nom' }, { v: 'recent', label: 'Les plus récents' }, { v: 'size', label: 'Les plus gros' }], s.sort, v => { s.sort = v; app.persist(); refilter(); renderGrid(); });
      return [h('div', { class: 'search' }, search, fav), chips, row('Dossier', folderPick), row('Trier', sortPick)];
    }

    function renderGrid() {
      const grid = document.getElementById('res-grid');
      if (!grid) return;
      grid.innerHTML = '';
      if (R.observer) R.observer.disconnect();
      queue = [];
      const list = R.filtered;
      if (!list.length) {
        grid.appendChild(h('div', { class: 'empty' }, R.list.length ? 'Aucune ressource ne correspond.' : 'Rien dans les dossiers liés (ou pas encore indexés).'));
      }
      const favs = new Set(st().favs);
      list.slice(0, R.shown).forEach(e => {
        const cv = h('canvas', { width: 160, height: 90 });
        const t = A.typeById[e.type];
        const card = h('div', { class: 'card' + (R.sel && R.sel.id === e.id ? ' on' : ''), title: e.rel, 'data-id': e.id },
          h('div', { class: 'thumb' }, cv, h('span', { class: 'user-mark' }, t.label), e.type === 'audio' ? h('span', { class: 'play-mark' }, '▶') : null),
          h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, e.name), favs.has(e.id) ? h('span', { class: 'fav-mark' }, '★') : null));
        card.addEventListener('click', () => select(e));
        if (e.type === 'audio') card.querySelector('.play-mark').addEventListener('click', ev => { ev.stopPropagation(); playSound(e); });
        grid.appendChild(card);
        observe(card, cv, e);
      });
      const more = document.getElementById('res-more');
      if (more) {
        more.innerHTML = '';
        const left = list.length - R.shown;
        if (left > 0) more.appendChild(btn('Afficher plus (' + left + ')', () => { R.shown += PAGE * 2; renderGrid(); }, 'quiet'));
        if (list.length) more.appendChild(h('span', { class: 'muted' }, ' ' + app.plural(list.length, 'ressource')));
      }
    }

    function select(e) {
      R.sel = e;
      document.querySelectorAll('#res-grid .card').forEach(c => c.classList.toggle('on', c.dataset.id === e.id));
      renderInspector();
      app.renderCTA();
    }

    function toggleFav(e) {
      const s = st(), i = s.favs.indexOf(e.id);
      if (i >= 0) s.favs.splice(i, 1); else s.favs.push(e.id);
      app.persist();
      renderInspector();
      renderGrid();
    }

    function renderInspector() {
      const ins = document.getElementById('res-inspector');
      if (!ins) return;
      ins.innerHTML = '';
      const e = R.sel;
      if (!e) return;
      const t = A.typeById[e.type], fav = st().favs.indexOf(e.id) >= 0;
      ins.appendChild(h('div', { class: 'effect-head' },
        h('span', { class: 'effect-name' }, e.name),
        h('span', { class: 'badge' }, t.label + ' · .' + e.ext),
        h('div', { class: 'effect-tools' }, btn(fav ? '★' : '☆', () => toggleFav(e), 'quiet icon' + (fav ? ' on' : ''), 'Favori'))));
      ins.appendChild(h('div', { class: 'note res-path', title: e.path || e.rel }, (e.folder ? e.rootName + ' / ' + e.folder.split('/').join(' / ') : e.rootName) + ' · ' + A.formatSize(e.size)));

      const pv = h('div', { class: 'res-preview' });
      ins.appendChild(pv);
      const actions = [];
      const here = () => place(e, 'playhead'), markers = () => place(e, 'markers');
      if (e.type === 'video' || e.type === 'image') {
        if (e.type === 'video') {
          const v = h('video', { class: 'res-video', src: urlOf(e), muted: true, loop: true, playsinline: true, controls: true });
          v.muted = true;
          v.addEventListener('error', () => { pv.innerHTML = ''; pv.appendChild(h('div', { class: 'note' }, 'Aperçu impossible dans le panneau (codec). Le fichier reste utilisable dans Premiere.')); }, { once: true });
          pv.appendChild(v);
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else if (BROWSER_IMAGES.test(e.ext)) pv.appendChild(h('img', { class: 'res-image', src: urlOf(e), alt: e.name }));
        else pv.appendChild(h('div', { class: 'note' }, 'Aperçu non disponible pour .' + e.ext + ' : le fichier reste utilisable dans Premiere.'));
        actions.push(btn('Poser à la tête de lecture', here), btn('Poser sur chaque marqueur', markers));
        actions.push(btn('Utiliser comme overlay', () => app.services.addOverlay(e.file ? { name: e.fileName, url: urlOf(e) } : e.path), '', 'L\'ajoute aux overlays de l\'onglet Effets : fondu, mode de fusion, posé sur les coupes'));
        if (e.type === 'image') actions.push(row('Durée d\'une image', hotText({ value: st().imageDur, min: 0.2, max: 60, step: 0.1, unit: 's', onChange: v => { st().imageDur = v; app.persist(); } })));
      } else if (e.type === 'audio') {
        const cv = h('canvas', { class: 'wave-canvas' });
        pv.appendChild(cv);
        requestAnimationFrame(async () => {
          const { g, w, h: hh } = fitCanvas(cv, 70);
          g.fillStyle = css('--bg-2'); g.fillRect(0, 0, w, hh);
          try {
            const p = await soundPeaks(e, Math.max(60, Math.round(w / 3)));
            if (!p || !cv.isConnected) return;
            const tmp = h('canvas', { width: cv.width, height: cv.height });
            drawPeaks(tmp, p, css('--accent'));
            cv.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
            cv.getContext('2d').drawImage(tmp, 0, 0);
            pv.appendChild(h('div', { class: 'note' }, (Math.round(p.duration * 10) / 10).toString().replace('.', ',') + ' s' + (p.duration >= 11.9 ? ' et plus' : '')));
          } catch (err) { /* forme d'onde indisponible */ }
        });
        const play = btn(R.playing === e.id ? '■ Stop' : '▶ Écouter', () => playSound(e, play));
        actions.push(play, btn('Poser à la tête de lecture', here), btn('Poser sur chaque marqueur', markers, '', 'Un son sur chaque marqueur (ceux des clips sélectionnés s\'il y en a) : whooshs et impacts sur les coupes'));
      } else if (e.type === 'lut') {
        if (e.ext === 'cube') {
          const cv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
          const label = h('span', { class: 'pv-label' }, 'Après · ' + (Pv.isReal() ? 'ta séquence' : 'plan de test'));
          const frame = h('div', { class: 'pv-frame' }, cv, label);
          pv.appendChild(frame);
          let lut = null, before = false;
          const draw = () => gradeOnto(cv, Pv.shots()[(Pv.isReal() ? 'B' : 'A')], before ? null : lut);
          lutOf(e).then(l => { lut = l; draw(); }).catch(err => { pv.innerHTML = ''; pv.appendChild(h('div', { class: 'note' }, 'LUT illisible : ' + app.errorMessage(err))); });
          // Maintenir pour voir l'image d'origine.
          frame.addEventListener('pointerdown', () => { before = true; label.textContent = 'Avant'; draw(); });
          const up = () => { if (!before) return; before = false; label.textContent = 'Après · ' + (Pv.isReal() ? 'ta séquence' : 'plan de test'); draw(); };
          frame.addEventListener('pointerup', up);
          frame.addEventListener('pointerleave', up);
          pv.appendChild(h('div', { class: 'note' }, 'Maintiens le clic sur l\'image pour voir l\'avant. « 📷 Ma vraie image » (onglet Effets) montre la LUT sur ta séquence.'));
        } else pv.appendChild(h('div', { class: 'note' }, 'Aperçu disponible pour les LUT .cube.'));
        actions.push(btn('Calque de réglage Lumetri', () => lumetriLayer(e), '', 'Calque de réglage avec Lumetri sur le clip visé ; le chemin de la LUT est copié'), btn('Installer dans Lumetri', () => installLut(e), '', 'Copie la LUT dans le dossier Adobe : elle apparaît dans Lumetri > Créatif > Look après redémarrage'));
      } else if (e.type === 'font') {
        const sample = h('input', { class: 'textfield', value: app.settings().titles && app.settings().titles.text ? app.settings().titles.text.split('\n')[0].slice(0, 40) : 'Le son de la nuit 2026' });
        const box = h('div', { class: 'res-font' });
        const show = fam => {
          box.innerHTML = '';
          [44, 26, 15].forEach(px => box.appendChild(h('div', { style: { fontFamily: '"' + fam + '"', fontSize: px + 'px' } }, sample.value || 'Aa')));
        };
        fontFamily(e).then(fam => { show(fam); sample.addEventListener('input', () => show(fam)); }).catch(() => { box.textContent = 'Police illisible dans le panneau.'; });
        pv.appendChild(sample);
        pv.appendChild(box);
        actions.push(btn('Installer la police', () => installFont(e)));
      } else if (e.type === 'mogrt') {
        pv.appendChild(h('div', { class: 'note' }, 'Modèle d\'animations graphiques (titre, lower third…). Il garde ses réglages dans « Objets graphiques essentiels ».'));
        actions.push(btn('Poser à la tête de lecture', here), btn('Utiliser dans l\'onglet Textes', () => useAsTitle(e), '', 'Paroles et titres animés avec ce modèle'));
      } else {
        const rr = /\.(rrfx|cutfx)\.json$/i.test(e.fileName);
        pv.appendChild(h('div', { class: 'note' }, rr ? 'Effets exportés depuis RR FX.'
          : e.ext === 'prfpset' ? 'Préréglage d\'effets Premiere : panneau Effets > clic droit sur « Préréglages » > Importer les préréglages…, puis choisis ce fichier.'
            : e.ext === 'epr' ? 'Préréglage d\'export (Media Encoder / Exporter).' : 'Fichier de projet ou de préréglage.'));
        if (rr) actions.push(btn('Ajouter à Mes effets', () => addPresetFile(e)));
      }
      if (e.type !== 'font' && e.type !== 'lut' && e.type !== 'preset' && e.type !== 'mogrt') actions.push(btn('Importer dans le projet', () => importOne(e), 'quiet'));
      if (e.path) actions.push(btn(Store.isWin() ? 'Afficher dans l\'Explorateur' : 'Afficher dans le Finder', () => reveal(e), 'quiet'));
      const buttons = actions.filter(a => a.tagName === 'BUTTON'), others = actions.filter(a => a.tagName !== 'BUTTON');
      ins.appendChild(section('Actions', [h('div', { class: 'row-buttons wrap' }, buttons)].concat(others)));
    }

    function render(view) {
      if (view) R.view = view;
      view = R.view;
      // Onglet caché (indexation finie en arrière-plan) : rien à dessiner.
      if (!view || !view.isConnected || app.S.tab !== 'assets') return;
      loadIndex();
      view.innerHTML = '';
      const s = st();
      const linkBtn = btn('＋ Lier un dossier…', linkFolder);
      const refresh = btn('↻ Actualiser', () => scanRoots(s.roots.filter(r => !(R.index[r] && R.index[r].browser))), 'quiet', 'Relire les dossiers (nouveaux fichiers, fichiers supprimés)');
      view.appendChild(section('Dossiers liés', [
        s.roots.length ? renderRoots() : h('div', { class: 'note' }, 'Lie le dossier où tu ranges tes effets, SFX, polices, LUTs, titres et overlays : RR FX les classe et tu les retrouves ici, avec aperçu, prêts à poser dans la timeline. Les fichiers restent où ils sont.'),
        h('div', { class: 'row-buttons' }, linkBtn, s.roots.length && Store.fs ? refresh : null)
      ]));
      if (!s.roots.length) return;
      view.appendChild(section('Parcourir', renderFilters()));
      view.appendChild(h('div', { class: 'grid', id: 'res-grid' }));
      view.appendChild(h('div', { class: 'res-more', id: 'res-more' }));
      view.appendChild(h('div', { id: 'res-inspector' }));
      renderGrid();
      renderInspector();
      // Index jamais fait ou ancien : relu en arrière-plan.
      const stale = s.roots.filter(r => Store.fs && (!R.index[r] || Date.now() - R.index[r].scanned > STALE_MS));
      if (stale.length && !app.S.busy) setTimeout(() => { if (!app.S.busy && app.S.tab === 'assets') scanRoots(stale, 'Mise à jour des ressources'); }, 300);
    }

    app.tabs.assets = {
      render,
      addFiles: addBrowserFiles,
      cta: () => {
        if (!st().roots.length) return { label: 'Lier un dossier…', run: linkFolder, enabled: true };
        if (R.sel) { const a = mainAction(R.sel); return { label: a.label, run: a.run, enabled: true }; }
        return { label: 'Choisis une ressource', run: () => {}, enabled: false };
      },
      leave: () => { stopSound(); if (R.observer) R.observer.disconnect(); queue = []; }
    };
  });
})(typeof self !== 'undefined' ? self : this);
