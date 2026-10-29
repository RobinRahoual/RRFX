/* RR FX : onglet Effets : les effets (fournis, perso, overlays), leurs aperçus, l'inspecteur, l'application
   sur la coupe, les marqueurs, les temps forts, et l'enchaînement d'effets.
   Découpé de main.js : l'état et les services communs arrivent par « core ». */
(function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (window.RRFXPanels = window.RRFXPanels || []).push(function (core) {
    const Core = window.RRFXCore, Host = window.RRFXHost, Lib = window.RRFXLibrary, Packs = window.RRFXPacks, Pv = window.RRFXPreview, Sons = window.RRFXSons, Store = window.RRFXStorage;
    const { CurveEditor, Player, actionGroup, checkbox, h, hotText, picker, row, section } = window.RRFXUI;
    const { $, status, BLENDS, CATS, PLACEMENTS, S, VARIATIONS, app, catLabel, clone, errorMessage, fps, hostPlacement,
      isFull, isMulti, log, persist, plural, promptName, pushHistory, registry, renderCTA, runTask, settings,
      uid } = core;

    // ---------------------------------------------------------------- effets (entrées)

    function entries() {
      const out = Lib.EFFECTS.map(def => ({ key: 'b:' + def.id, kind: 'builtin', name: def.name, cat: def.cat, def }));
      S.lib.items.forEach(item => {
        if (item.type === 'preset') {
          const def = Lib.byId[item.data.base];
          if (def) out.push({ key: 'u:' + item.id, kind: 'preset', name: item.name, cat: item.cat || def.cat, def, item });
        } else if (item.type === 'captured' && Array.isArray(item.data.components)) {
          out.push({ key: 'u:' + item.id, kind: 'captured', name: item.name, cat: item.cat || 'mine', def: null, item });
        }
      });
      (settings().overlays || []).forEach(o => out.push({ key: 'o:' + o.id, kind: 'overlay', name: o.name, cat: 'overlay', def: null, overlay: o }));
      // Packs fournis : dessinés par RR FX, fabriqués en images à la première utilisation.
      Packs.ALL.forEach(d => out.push({ key: 'p:' + d.id, kind: 'overlay', name: d.name, cat: 'overlay', def: null, overlay: { id: 'pack:' + d.id, name: d.name, kind: 'sequence', pack: d.id, start: 'random' } }));
      return out;
    }

    const entryByKey = key => entries().find(e => e.key === key) || null;

    function defaultParams(entry) {
      if (entry.kind === 'overlay') return { frames: 10, intensity: 85, curve: Core.curveValue('easeInOut'), start: entry.overlay.start || 'random' };
      if (entry.kind === 'captured') return { frames: Math.max(1, entry.item.data.frames || 8), stretch: true, mirror: true };
      const p = Core.paramDefaults(entry.def);
      if (entry.kind === 'preset') Object.assign(p, clone(entry.item.data.params || {}));
      return p;
    }

    function compileFor(entry, params, side, N, rate) {
      if (entry.kind === 'overlay') return Core.compileOverlay(params, side, N, settings().overlayBlend);
      if (entry.kind === 'captured') return Core.compileCaptured(entry.item.data, side, N, { stretch: params.stretch, mirror: params.mirror }, registry());
      return Core.compileEffect(entry.def, params, side, N, rate, registry());
    }

    // Tous les effets se posent sur un calque de réglage. Seuls ceux qui ont besoin des images
    // du plan (Motion blur / Écho : « CLIP FX ») se posent sur une copie du plan.
    const targetFor = entry => (entry.kind === 'overlay' ? 'overlay' : entry.def && entry.def.target ? entry.def.target : 'adjustment');

    function activeSides() {
      const pl = settings().placement, side = settings().side;
      if (pl === 'clipStart') return ['post'];
      if (pl === 'clipEnd') return ['pre'];
      if (isFull(pl)) return [side === 'pre' ? 'pre' : 'post'];
      return side === 'both' ? ['pre', 'post'] : [side];
    }

    const isFav = entry => S.lib.favorites.indexOf(entry.key) >= 0;
    function toggleFav(entry) {
      const i = S.lib.favorites.indexOf(entry.key);
      if (i >= 0) S.lib.favorites.splice(i, 1); else S.lib.favorites.push(entry.key);
      persist();
    }

    // ---------------------------------------------------------------- aperçus

    function previewFrames(entry, params, sides) {
      const N = Math.max(1, Math.round(params.frames));
      const specs = {
        pre: sides.indexOf('pre') >= 0 ? compileFor(entry, params, 'pre', N, fps()) : null,
        post: sides.indexOf('post') >= 0 ? compileFor(entry, params, 'post', N, fps()) : null
      };
      return Pv.buildTimeline(specs, { pre: N, post: N }, 6);
    }

    // ---------------------------------------------------------------- overlays (médias)

    const fileURL = p => {
      const u = String(p).replace(/\\/g, '/');
      return 'file://' + (u[0] === '/' ? '' : '/') + encodeURI(u).replace(/#/g, '%23').replace(/\?/g, '%3F');
    };
    const ovMedia = new Map();
    // L'image ou la vidéo d'un overlay, chargée une fois (lecture en boucle, muette).
    function overlayMedia(o, onReady) {
      let m = ovMedia.get(o.id);
      if (!m) {
        const isImage = o.kind === 'image';
        const el = isImage ? new Image() : document.createElement('video');
        m = { el, ready: false, waiting: [] };
        ovMedia.set(o.id, m);
        const ok = () => { m.ready = true; m.waiting.splice(0).forEach(f => f()); };
        if (isImage) el.onload = ok;
        else {
          el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
          el.addEventListener('loadeddata', () => { try { el.currentTime = Math.min(1, (el.duration || 2) * 0.3); } catch (e) { /* lecture seule */ } ok(); }, { once: true });
        }
        el.onerror = () => { m.failed = true; };
        el.src = o.url || fileURL(o.path);
      }
      if (m.ready) onReady && onReady(m);
      else if (onReady) m.waiting.push(() => onReady(m));
      return m;
    }

    // Les vidéos d'overlays ne tournent que pendant qu'on regarde leur aperçu.
    function pauseOverlayVideos(except) {
      ovMedia.forEach((m, id) => { if (id !== except && m.el.pause && !m.el.paused) m.el.pause(); });
    }

    function blendCss(v) { return (BLENDS.find(b => b.v === Number(v)) || BLENDS[0]).css; }

    // Image n d'un overlay de pack, dessinée à la taille voulue (canevas réutilisé).
    const packCanvas = {};
    function packFrame(id, w, h, n) {
      const key = w + 'x' + h;
      const c = packCanvas[key] || (packCanvas[key] = document.createElement('canvas'));
      c.width = w; c.height = h;
      const total = Packs.frameCount(fps()), i = ((Math.round(n) % total) + total) % total;
      Packs.draw(c.getContext('2d'), w, h, i / (total - 1), i, Packs.byId[id]);
      return c;
    }

    // Fabrique (une fois) la séquence d'images JPEG d'un overlay de pack, à la taille de la
    // séquence. Renvoie { path: première image, fps } ou null si arrêté.
    async function buildPack(def, rate) {
      const size = Packs.frameSize(S.ctx && S.ctx.frameW, S.ctx && S.ctx.frameH), total = Packs.frameCount(rate);
      if (!Store.fs) return { path: Packs.fileName(def, 0), fps: rate };
      const dir = Store.path.join(Store.dir, 'Overlays', Packs.folderName(def, size.W, size.H, rate));
      const first = Store.path.join(dir, Packs.fileName(def, 0)).replace(/\\/g, '/');
      if (Store.fs.existsSync(Store.path.join(dir, 'ok.json'))) return { path: first, fps: rate };
      Store.fs.mkdirSync(dir, { recursive: true });
      status.phase(_T('Fabrication de « ') + def.name + _T(' » (') + size.W + '×' + size.H + _T(', une seule fois)'));
      const c = document.createElement('canvas');
      c.width = size.W; c.height = size.H;
      const g = c.getContext('2d');
      for (let i = 0; i < total; i++) {
        if (S.cancel) return null;
        status.progress(i, total, '');
        Packs.draw(g, size.W, size.H, i / (total - 1), i, def);
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
        if (!blob) throw new Error(_T('Image de l\'overlay non fabriquée (mémoire ?)'));
        Store.fs.writeFileSync(Store.path.join(dir, Packs.fileName(def, i)), new Uint8Array(await blob.arrayBuffer()));
      }
      Store.fs.writeFileSync(Store.path.join(dir, 'ok.json'), JSON.stringify({ id: def.id, frames: total, fps: rate, W: size.W, H: size.H }));
      log(_T('Overlay « ') + def.name + _T(' » fabriqué : ') + dir, 'ok');
      return { path: first, fps: rate };
    }

    function drawOverlayOn(g, entry, alpha, n) {
      if (alpha <= 0.001) return;
      const cw = g.canvas.width, ch = g.canvas.height;
      if (entry.overlay.pack) {
        const img = packFrame(entry.overlay.pack, cw, ch, n || 0);
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = Math.min(1, alpha);
        g.globalCompositeOperation = blendCss(settings().overlayBlend);
        g.drawImage(img, 0, 0);
        g.restore();
        return;
      }
      const m = overlayMedia(entry.overlay);
      if (!m.ready) return;
      const el = m.el;
      const iw = el.videoWidth || el.naturalWidth || 16, ih = el.videoHeight || el.naturalHeight || 9, k = Math.max(cw / iw, ch / ih);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = Math.min(1, alpha);
      g.globalCompositeOperation = blendCss(settings().overlayBlend);
      try { g.drawImage(el, (cw - iw * k) / 2, (ch - ih * k) / 2, iw * k, ih * k); } catch (e) { /* vidéo pas encore lisible */ }
      g.restore();
    }

    const OVERLAY_FILES = /\.(mov|mp4|m4v|webm|png|jpe?g)$/i;
    function overlayFrom(file) {
      const p = typeof file === 'string' ? file : file.path || file.name;
      const name = String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      return { id: uid(), name, path: p, kind: /\.(png|jpe?g)$/i.test(p) ? 'image' : 'video', start: 'random', url: typeof file === 'string' ? undefined : file.url };
    }
    function addOverlayList(list) {
      const st = settings(), known = new Set(st.overlays.map(o => o.path));
      const fresh = list.map(overlayFrom).filter(o => OVERLAY_FILES.test(o.path) && !known.has(o.path));
      if (!fresh.length) { status.finish('warn', _T('Aucun overlay ajouté'), _T('Formats pris en charge : MOV, MP4, WEBM, PNG, JPG (ou déjà dans la liste).')); return; }
      st.overlays = st.overlays.concat(fresh);
      persist();
      S.cat = 'overlay';
      S.cur = entryByKey('o:' + fresh[0].id);
      S.params = defaultParams(S.cur);
      renderEffectsView();
      status.finish('ok', plural(fresh.length, _T('overlay ajouté'), _T('overlays ajoutés')), _T('Choisis-en un, règle sa durée et son mode de fusion, puis applique-le sur tes coupes.'));
    }
    function addOverlays(fromFolder) {
      if (fromFolder === true) {
        const dirs = Store.pickFiles(_T('Choisir un dossier d\'overlays'), [], true);
        if (dirs && dirs.length) addOverlayList(Store.listFiles(dirs[0], OVERLAY_FILES, 200, 3));
        return;
      }
      const picked = Store.pickFiles(_T('Choisir des overlays (vidéos ou images)'), ['mov', 'mp4', 'm4v', 'webm', 'png', 'jpg', 'jpeg']);
      if (picked) { if (picked.length) addOverlayList(picked); return; }
      // Hors de Premiere (démo) : sélecteur du navigateur.
      const input = h('input', { type: 'file', class: 'hidden', multiple: true, accept: 'video/*,image/png,image/jpeg' });
      input.addEventListener('change', () => addOverlayList(Array.from(input.files).map(f => ({ name: f.name, url: URL.createObjectURL(f) }))));
      input.click();
    }
    async function learnBlend() {
      const r = await Host.call('readBlend', {});
      if (!r.ok) return status.finish('error', _T('Mode de fusion illisible'), r.error);
      settings().overlayBlend = Number(r.value);
      settings().overlayBlendLearned = true;
      persist();
      renderInspector();
      const known = BLENDS.find(b => b.v === Number(r.value));
      status.finish('ok', _T('Mode de fusion appris'), (known ? known.label : _T('valeur ') + r.value) + _T(' : utilisé pour tous les overlays.'));
    }

    // Aperçu sur la vraie image : 2 images exportées autour de la coupe la plus proche.
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(_T('image illisible')));
        img.src = src;
      });
    }
    function grabRealFrames() {
      return runTask(_T('Aperçu réel'), async () => {
        const dir = Store.cacheDir();
        if (!dir) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('L\'aperçu sur ta séquence exporte deux images de la timeline : il faut le panneau dans Premiere.') };
        Store.listFiles(dir, /^rrfx-frame-/, 50, 0).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
        status.phase(_T('Export de deux images autour de la coupe'));
        const r = await Host.call('grabFrames', { folder: dir.replace(/\\/g, '/'), prefix: 'rrfx-frame-' + uid() + '-' });
        if (!r.ok) return { kind: 'error', title: _T('Aperçu réel impossible'), detail: r.error };
        // Premiere écrit les fichiers après coup : on attend qu'ils existent (avec ou sans .png).
        const found = [];
        for (let t = 0; t < 40 && found.length < r.files.length; t++) {
          found.length = 0;
          r.files.forEach(f => { const g = [f, f + '.png'].find(x => Store.fs.existsSync(x) && Store.fs.statSync(x).size > 0); if (g) found.push(g); });
          if (found.length < r.files.length) await new Promise(res => setTimeout(res, 150));
        }
        if (found.length < r.files.length) return { kind: 'error', title: _T('Aperçu réel impossible'), detail: _T('Premiere n\'a pas écrit les images (') + dir + ').' };
        const imgs = await Promise.all(found.map(f => loadImage(fileURL(f) + '?' + Date.now())));
        Pv.setShots(imgs[0], imgs[1]);
        renderInspector();
        return { kind: 'ok', title: _T('Aperçu sur ta séquence'), detail: _T('Images autour de la coupe à ') + r.cut.toFixed(2) + _T(' s. « Plans de test » pour revenir.') };
      });
    }
    /* Images « propres » de la timeline aux instants donnés (secondes) : looks, titres et
       overlays coupés pendant l'export (level : on garde les étalonnages RR FX de niveau
       inférieur, 2 = conversion seule). Renvoie des ImageData de largeur w. Hors de Premiere :
       les plans de test. */
    async function grabClean(times, level, w, onProgress) {
      w = w || 320;
      const toData = img => {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, h2 = Math.max(1, Math.round(w * ih / iw));
        const c = document.createElement('canvas');
        c.width = w; c.height = h2;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h2);
        return g.getImageData(0, 0, w, h2);
      };
      const dir = Store.cacheDir();
      if (!dir || S.demo) return times.map((t, i) => toData(Pv.shots()[i % 2 ? 'B' : 'A']));
      Store.listFiles(dir, /^rrfx-clean-/, 400, 0).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
      const r = await Host.call('framesBegin', { times, level, folder: dir.replace(/\\/g, '/'), prefix: 'rrfx-clean-' + uid() + '-' });
      if (!r.ok) throw new Error(r.error);
      const found = new Array(r.files.length).fill(null);
      try {
        // Premiere écrit les images après coup (avec ou sans .png) : on les attend.
        const limit = 40 + r.files.length * 8;
        for (let t = 0; t < limit && found.some(f => !f); t++) {
          r.files.forEach((f, i) => { if (!found[i]) found[i] = [f, f + '.png'].find(x => Store.fs.existsSync(x) && Store.fs.statSync(x).size > 0) || null; });
          if (onProgress) onProgress(found.filter(Boolean).length / found.length);
          if (found.some(f => !f)) await new Promise(res => setTimeout(res, 150));
        }
        // Une image tout juste créée peut être encore en cours d'écriture.
        await new Promise(res => setTimeout(res, 250));
      } finally {
        await Host.call('framesEnd', { off: r.off });
      }
      if (found.some(f => !f)) throw new Error(_T('Premiere n\'a pas écrit toutes les images (') + dir + ').');
      const imgs = await Promise.all(found.map(f => loadImage(fileURL(f) + '?' + Date.now())));
      found.forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
      return imgs.map(toData);
    }
    function useTestShots() {
      Pv.resetShots();
      renderInspector();
    }

    // Vignettes déjà dessinées, par jeu d'images de test : changer d'onglet ou de catégorie ne
    // recalcule pas les flous et les filés de chaque carte.
    const thumbCache = new WeakMap();
    function drawThumb(canvas, entry) {
      if (entry.kind === 'overlay' && !entry.overlay.pack) {
        const g = canvas.getContext('2d');
        Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
        overlayMedia(entry.overlay, () => { Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null); drawOverlayOn(g, entry, 0.9); });
        return;
      }
      const shots = Pv.shots();
      let cache = thumbCache.get(shots);
      if (!cache) thumbCache.set(shots, cache = new Map());
      const key = entry.key + '|' + canvas.width + 'x' + canvas.height + '|' + (entry.overlay ? fps() : entry.item ? window.RRFXAssets.hashText(JSON.stringify(entry.item.data)) : '');
      const hit = cache.get(key), g = canvas.getContext('2d');
      if (hit) { g.drawImage(hit, 0, 0); return; }
      if (!paintThumb(canvas, entry)) return;
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      cache.set(key, copy);
    }

    function paintThumb(canvas, entry) {
      if (entry.kind === 'overlay') {
        const g = canvas.getContext('2d');
        Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
        drawOverlayOn(g, entry, 0.95, Math.round(fps() * 0.8));
        return true;
      }
      try {
        const p = defaultParams(entry);
        const side = entry.kind === 'captured' ? (entry.item.data.origin || 'post') : 'pre';
        const N = Math.max(2, Math.round(p.frames));
        const spec = compileFor(entry, p, side, N, 25);
        let i = side === 'pre' ? N - 1 : 0, j = side === 'pre' ? N - 2 : 1;
        // Un pic tout noir (dips) ne dit rien : on montre l'image d'avant.
        if (Pv.stateAt(spec, i).opacity < 0.15) { i = j; j = side === 'pre' ? Math.max(0, i - 1) : Math.min(N - 1, i + 1); }
        Pv.render(canvas.getContext('2d'), Pv.shots()[side === 'pre' ? 'A' : 'B'], Pv.stateAt(spec, i), Pv.stateAt(spec, j));
        return true;
      } catch (e) {
        log(_T('Vignette « ') + entry.name + _T(' » : ') + errorMessage(e), 'warn');
        return false;
      }
    }

    let thumbAnim = null;
    function animateThumb(canvas, entry) {
      stopThumb();
      if (entry.kind === 'overlay' && entry.overlay.pack) {
        // Survol d'un overlay de pack : il défile sur le plan de test.
        const g = canvas.getContext('2d');
        let n = 0, last = 0;
        const loop = ts => {
          thumbAnim = requestAnimationFrame(loop);
          if (ts - last < 40) return;
          last = ts;
          Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
          drawOverlayOn(g, entry, 0.95, n++);
        };
        thumbAnim = requestAnimationFrame(loop);
        return;
      }
      if (entry.kind === 'overlay') return;
      let frames;
      try { frames = previewFrames(entry, defaultParams(entry), ['pre', 'post']); } catch (e) { return; }
      let n = 0, last = 0;
      const g = canvas.getContext('2d');
      const loop = ts => {
        thumbAnim = requestAnimationFrame(loop);
        if (ts - last < 40) return;
        last = ts;
        Pv.renderTimelineFrame(g, frames, n);
        n = (n + 1) % frames.length;
      };
      thumbAnim = requestAnimationFrame(loop);
    }
    function stopThumb() {
      if (thumbAnim) cancelAnimationFrame(thumbAnim);
      thumbAnim = null;
    }

    // ---------------------------------------------------------------- onglet Effets

    function renderEffectsView() {
      const view = $('view-effects');
      view.innerHTML = '';
      const search = h('input', { class: 'textfield', placeholder: _T('Rechercher un effet'), value: S.search, spellcheck: 'false' });
      search.addEventListener('input', () => { S.search = search.value; renderGrid(); });
      const fav = h('button', { class: 'action icon' + (S.favOnly ? ' selected on' : ''), title: _T('Favoris uniquement') }, '★');
      fav.addEventListener('click', () => { S.favOnly = !S.favOnly; fav.classList.toggle('selected', S.favOnly); fav.classList.toggle('on', S.favOnly); renderGrid(); });
      view.appendChild(h('div', { class: 'search' }, search, fav));

      const chips = h('div', { class: 'chips' });
      [{ id: 'all', label: _T('Tout') }].concat(CATS, [{ id: 'mine', label: _T('Mes effets') }]).forEach(c => {
        const b = h('button', { class: 'action' + (S.cat === c.id ? ' selected' : '') }, c.label);
        b.addEventListener('click', () => {
          S.cat = c.id;
          chips.querySelectorAll('.action').forEach(x => x.classList.remove('selected'));
          b.classList.add('selected');
          renderGrid();
        });
        chips.appendChild(b);
      });
      view.appendChild(chips);
      view.appendChild(h('div', { class: 'grid', id: 'grid' }));
      view.appendChild(h('div', { id: 'inspector' }));
      renderGrid();
      renderInspector();
    }

    function visibleEntries() {
      const q = Core.normName(S.search);
      return entries().filter(e => {
        if (S.favOnly && !isFav(e)) return false;
        if (S.cat === 'mine' && e.kind === 'builtin') return false;
        if (S.cat !== 'all' && S.cat !== 'mine' && e.cat !== S.cat) return false;
        if (q && Core.normName(e.name + ' ' + catLabel(e.cat)).indexOf(q) < 0) return false;
        return true;
      });
    }

    function renderGrid() {
      const grid = $('grid');
      if (!grid) return;
      stopThumb();
      grid.innerHTML = '';
      const list = visibleEntries();
      if (S.cat === 'overlay') {
        const add = h('div', { class: 'card add-card', title: _T('Light leaks, grain, poussière, flares… (vidéos ou images)') }, h('div', { class: 'thumb add-thumb' }, '＋'), h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, _T('Ajouter des overlays'))));
        add.addEventListener('click', () => addOverlays(false));
        grid.appendChild(add);
        if (Store.onDisk) {
          const folder = h('div', { class: 'card add-card', title: _T('Ajoute toutes les vidéos et images d\'un dossier (pack d\'overlays)') }, h('div', { class: 'thumb add-thumb' }, '▤'), h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, _T('Ajouter un dossier'))));
          folder.addEventListener('click', () => addOverlays(true));
          grid.appendChild(folder);
        }
      }
      if (!list.length) {
        if (S.cat === 'overlay') return;
        grid.appendChild(h('div', { class: 'empty' }, S.cat === 'mine'
          ? _T('Aucun effet perso : enregistre un preset (« ＋ Preset » sur un effet) ou capture un clip dans « Mes effets ».')
          : _T('Aucun effet ne correspond.')));
        return;
      }
      list.forEach(e => {
        const cv = h('canvas', { width: 160, height: 90 });
        const card = h('div', { class: 'card' + (S.cur && S.cur.key === e.key ? ' on' : ''), 'data-key': e.key, title: e.def ? e.def.desc : _T('Effet capturé') },
          h('div', { class: 'thumb' }, cv, e.kind !== 'builtin' ? h('span', { class: 'user-mark' }, e.kind === 'overlay' && e.overlay.pack ? Packs.byId[e.overlay.pack].packName : ({ captured: _T('capturé'), overlay: 'overlay' })[e.kind] || 'preset') : null),
          h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, e.name),
            e.def && e.def.target ? h('span', { class: 'tag', title: _T('Posé sur une copie du plan (un calque de réglage ne peut pas mélanger les images)') }, 'CLIP FX') : null,
            isFav(e) ? h('span', { class: 'fav-mark' }, '★') : null,
            settings().vary === 'chain' && settings().chain.keys.includes(e.key) ? h('span', { class: 'chain-mark', title: _T('Dans l\'enchaînement') }, String(settings().chain.keys.indexOf(e.key) + 1)) : null));
        card.addEventListener('click', ev => (ev.shiftKey ? toggleChain(e) : selectEntry(e)));
        card.addEventListener('mouseenter', () => animateThumb(cv, e));
        card.addEventListener('mouseleave', () => { stopThumb(); drawThumb(cv, e); });
        grid.appendChild(card);
        drawThumb(cv, e);
      });
    }

    function selectEntry(e, keepParams) {
      S.cur = e;
      if (!keepParams) S.params = defaultParams(e);
      if (e.kind === 'captured' && e.item.data.origin && !isFull(settings().placement) && settings().side !== 'both') settings().side = e.item.data.origin;
      // Les mouvements (Ken Burns, zoom lent, punch-in…) se posent sur tout le plan.
      if (e.def && e.def.cat === 'motion' && !isFull(settings().placement)) {
        settings().placement = 'full';
        persist();
        status.finish('ok', e.name + _T(' : sur les clips entiers'), _T('Ce mouvement dure tout le plan. Sélectionne tes clips, puis applique.'));
      }
      const grid = $('grid');
      if (grid) grid.querySelectorAll('.card').forEach(c => c.classList.toggle('on', c.dataset.key === e.key));
      renderInspector();
      renderCTA();
    }

    let pvFrames = [];
    function buildStrip(strip) {
      strip.innerHTML = '';
      const counts = { A: 0, pre: 0, post: 0, B: 0 };
      pvFrames.forEach(f => { counts[f.zone]++; });
      ['A', 'pre', 'post', 'B'].forEach(z => {
        if (counts[z]) strip.appendChild(h('div', { class: 'zone ' + z, style: { flex: String(counts[z]) } }, z === 'pre' ? 'PRE' : z === 'post' ? 'POST' : ''));
      });
      strip.appendChild(h('div', { class: 'cutmark', style: { left: (pvFrames.findIndex(f => f.shot === 'B') / Math.max(1, pvFrames.length) * 100) + '%' } }));
      strip.appendChild(h('div', { class: 'pv-head', id: 'pv-head' }));
    }

    function paramChanged(final) {
      if (S.player) S.player.redraw();
      if (S.curveEd) S.curveEd.draw();
      if (final) { const strip = $('pv-strip'); if (strip) buildStrip(strip); }
    }

    function renderInspector() {
      const ins = $('inspector');
      if (!ins) return;
      if (S.player) { S.player.stop(); S.player = null; }
      S.curveEd = null;
      ins.innerHTML = '';
      const e = S.cur;
      if (!e) {
        ins.appendChild(h('div', { class: 'empty' }, _T('Choisis un effet ci-dessus.')));
        return;
      }
      const p = S.params, def = e.def, st = settings();

      const star = h('button', { class: 'action quiet icon' + (isFav(e) ? ' on' : ''), title: _T('Favori') }, isFav(e) ? '★' : '☆');
      star.addEventListener('click', () => { toggleFav(e); star.textContent = isFav(e) ? '★' : '☆'; star.classList.toggle('on', isFav(e)); renderGrid(); });
      const save = h('button', { class: 'action quiet', title: e.kind === 'captured' ? _T('Dupliquer avec ces réglages') : _T('Enregistrer ces réglages comme preset') }, '＋ Preset');
      save.addEventListener('click', saveAsPreset);
      ins.appendChild(h('div', { class: 'effect-head' },
        h('span', { class: 'effect-name' }, e.name),
        h('span', { class: 'badge' }, e.kind === 'captured' ? _T('capturé') : e.kind === 'overlay' ? 'overlay' : e.kind === 'preset' ? 'preset · ' + catLabel(e.cat) : catLabel(e.cat)),
        h('div', { class: 'effect-tools' }, star, e.kind === 'overlay' ? null : save)));
      if (def && def.desc) ins.appendChild(h('div', { class: 'note' }, def.desc));
      if (def && def.face) ins.appendChild(h('div', { class: 'hint-box' }, def.track === 'object'
        ? _T('🎯 Au moment d\'appliquer, la première image du plan s\'affiche : entoure l\'objet, RR FX le suit dans tout le plan.')
        : _T('🙂 Le visage est cherché et suivi automatiquement dans chaque plan au moment d\'appliquer (quelques secondes). L\'aperçu ci-dessous suppose un visage en haut du cadre.')));
      if (e.kind === 'overlay') {
        ins.appendChild(h('div', { class: 'note' }, e.overlay.pack
          ? _T('Pack « ') + Packs.byId[e.overlay.pack].packName + _T(' », fourni avec RR FX. À la première utilisation, il est fabriqué à la taille de ta séquence (quelques secondes), puis réutilisé.')
          : e.overlay.path || e.overlay.name));
      }

      // Aperçu
      const cv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
      const play = h('button', { class: 'action quiet icon', title: _T('Lecture / pause') }, '❚❚');
      const strip = h('div', { class: 'pv-strip', id: 'pv-strip' });
      const g = cv.getContext('2d');
      pvFrames = previewFrames(e, p, activeSides());
      S.player = Player({
        length: () => pvFrames.length,
        fps: () => fps(),
        draw: n => {
          if (!pvFrames[n]) return;
          Pv.renderTimelineFrame(g, pvFrames, n);
          if (S.cur && S.cur.kind === 'overlay') {
            const f = pvFrames[n], pr = f.spec && f.spec[0].props.find(x => x.key === 'opacity');
            if (pr) drawOverlayOn(g, S.cur, (pr.values ? pr.values[Math.min(f.i, pr.values.length - 1)] : pr.static) / 100, n);
          }
          const head = $('pv-head');
          if (head) head.style.left = (n / Math.max(1, pvFrames.length - 1) * 100) + '%';
        }
      });
      const redraw = S.player.redraw;
      S.player.redraw = () => { pvFrames = previewFrames(S.cur, S.params, activeSides()); redraw(); };
      const setPlay = on => { play.textContent = on ? '❚❚' : '▶'; };
      play.addEventListener('click', () => setPlay(S.player.toggle()));
      strip.addEventListener('pointerdown', ev => {
        const seek = x => { const r = strip.getBoundingClientRect(); S.player.seek(Math.round(Core.clamp((x - r.left) / r.width, 0, 1) * (pvFrames.length - 1))); };
        if (S.player.playing) setPlay(S.player.toggle());
        seek(ev.clientX);
        strip.setPointerCapture(ev.pointerId);
        const mv = m => seek(m.clientX);
        const up = () => { strip.removeEventListener('pointermove', mv); strip.removeEventListener('pointerup', up); };
        strip.addEventListener('pointermove', mv);
        strip.addEventListener('pointerup', up);
      });
      buildStrip(strip);
      pauseOverlayVideos(e.kind === 'overlay' ? e.overlay.id : null);
      if (e.kind === 'overlay' && !e.overlay.pack) overlayMedia(e.overlay, m => { if (m.el.play && S.cur === e) { const p2 = m.el.play(); if (p2 && p2.catch) p2.catch(() => {}); } });
      const real = h('button', { class: 'action quiet', title: Pv.isReal() ? _T('Revenir aux plans de test') : _T('Utiliser les images de ta séquence autour de la coupe la plus proche') }, Pv.isReal() ? _T('Plans de test') : _T('📷 Ma vraie image'));
      real.addEventListener('click', () => (Pv.isReal() ? useTestShots() : grabRealFrames()));
      ins.appendChild(h('div', { class: 'preview' },
        h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, Pv.isReal() ? _T('Aperçu sur ta séquence') : _T('Aperçu simulé'))),
        h('div', { class: 'pv-bar' }, play, strip, real)));

      // Placement
      const pl = st.placement;
      let sideCtl;
      if (pl === 'clipStart' || pl === 'clipEnd') {
        sideCtl = h('span', { class: 'muted' }, pl === 'clipStart' ? _T('POST, depuis le début') : _T('PRE, jusqu\'à la fin'));
      } else {
        const opts = [{ v: 'pre', label: 'PRE', cls: 'pre' }, { v: 'post', label: 'POST', cls: 'post' }];
        if (!isFull(pl)) opts.push({ v: 'both', label: 'PRE + POST' });
        sideCtl = actionGroup(opts, isFull(pl) ? (st.side === 'pre' ? 'pre' : 'post') : st.side, v => { st.side = v; persist(); paramChanged(true); });
      }
      const forced = def && def.target;
      const multi = isMulti(pl);
      const where = e.kind === 'overlay' ? _T('Overlay posé au-dessus du clip')
        : forced ? _T('CLIP FX : copie du plan au-dessus du clip') : _T('Calque de réglage au-dessus du clip');
      const volRows = [];
      if (e.kind !== 'captured') {
        volRows.push(h('div', { class: 'field' }, checkbox(_T('Intensité qui suit le volume de la musique'), st.volumeFollow, v => { st.volumeFollow = v; persist(); renderInspector(); })));
        if (st.volumeFollow) volRows.push(row('Influence', hotText({ value: st.volumeInfluence, min: 0, max: 100, step: 5, unit: '%', onChange: v => { st.volumeInfluence = v; persist(); } })));
      }
      ins.appendChild(section('Placement', [
        row(_T('Côté'), sideCtl),
        row('Position', picker(PLACEMENTS, pl, v => { st.placement = v; persist(); renderInspector(); renderCTA(); })),
        multi ? row(_T('Entre les coupes'), picker(VARIATIONS, st.vary, v => { st.vary = v; persist(); renderInspector(); renderCTA(); }), { title: _T('Varier le résultat à chaque coupe ou marqueur') }) : null,
        multi && st.vary === 'chain' ? chainRow() : null,
        isFull(pl) ? row(_T('Plans'), actionGroup([{ v: false, label: _T('Tous') }, { v: true, label: _T('Un sur deux') }], !!st.alternate, v => { st.alternate = v; persist(); }), { title: _T('Un sur deux : alterne cadrage large et serré, pour masquer les jump cuts') }) : null,
        row(_T('Posé sur'), h('span', { class: 'muted', title: forced ? _T('Un calque de réglage ne peut pas mélanger les images du plan : cet effet se pose sur une copie du passage. Le clip d\'origine n\'est jamais modifié.') : _T('Le clip d\'origine n\'est jamais modifié') }, where)),
        volRows,
        row(_T('Son'),  picker(SFX_CHOICES, st.sfx || 'none', v => { st.sfx = v; persist(); }), { title: _T('Sons fournis par RR FX, calés pour que leur moment fort tombe sur la coupe (piste audio libre, ta musique n\'est pas touchée)') })
      ]));

      // Paramètres
      const rows = [row(_T('Durée'), hotText({ value: p.frames, min: 1, max: 240, step: 1, unit: 'i', onChange: (v, fin) => { p.frames = v; paramChanged(fin); } }), { title: _T('Durée de chaque côté, en images') })];
      if (e.kind === 'overlay') {
        rows.push(row(_T('Opacité'), hotText({ value: Math.min(100, p.intensity), min: 0, max: 100, step: 1, unit: '%', onChange: (v, fin) => { p.intensity = v; paramChanged(fin); } })));
        rows.push(row(_T('Départ dans l\'overlay'), actionGroup([{ v: 'random', label: _T('Au hasard') }, { v: 'start', label: _T('Début') }, { v: 'middle', label: _T('Milieu') }], p.start, v => { p.start = v; })));
        const blendOpts = BLENDS.map(b => ({ v: String(b.v), label: b.label }));
        if (!BLENDS.some(b => b.v === Number(st.overlayBlend))) blendOpts.unshift({ v: String(st.overlayBlend), label: _T('Mode appris (') + st.overlayBlend + ')' });
        const learn = h('button', { class: 'action quiet', title: _T('Règle le mode de fusion voulu sur un clip dans Premiere, sélectionne-le, puis clique ici') }, _T('Apprendre'));
        learn.addEventListener('click', learnBlend);
        rows.push(row(_T('Mode de fusion'), h('div', { class: 'row-ctl' }, picker(blendOpts, String(st.overlayBlend), v => { st.overlayBlend = Number(v); persist(); paramChanged(true); }), learn)));
        const remove = h('button', { class: 'action quiet danger' }, _T('Retirer de la liste'));
        remove.addEventListener('click', () => {
          st.overlays = st.overlays.filter(o => o.id !== e.overlay.id);
          persist();
          S.cur = entries()[0];
          S.params = defaultParams(S.cur);
          renderGrid();
          renderInspector();
        });
        if (!e.overlay.pack) rows.push(h('div', { class: 'row-buttons' }, remove));
      } else if (e.kind === 'captured') {
        rows.push(h('div', { class: 'field' }, checkbox(_T('Étirer l\'animation à la durée'), p.stretch, v => { p.stretch = v; paramChanged(true); })));
        rows.push(h('div', null, checkbox(_T('Miroir pour l\'autre côté de la coupe'), p.mirror, v => { p.mirror = v; paramChanged(true); })));
        const d = e.item.data;
        rows.push(h('div', { class: 'note' }, (d.components || []).map(c => c.displayName).join(' · ') + _T(' · capturé sur ') + plural(d.frames || 0, _T('image'))));
      } else {
        rows.push(row(_T('Intensité'), hotText({ value: p.intensity, min: 0, max: 200, step: 1, unit: '%', onChange: (v, fin) => { p.intensity = v; paramChanged(fin); } })));
        (def.params || []).forEach(q => {
          if (q.type === 'range') rows.push(row(q.label, hotText({ value: p[q.key], min: q.min, max: q.max, step: q.step, unit: q.unit, onChange: (v, fin) => { p[q.key] = v; paramChanged(fin); } })));
          else if (q.type === 'select') rows.push(row(q.label, actionGroup(q.options.map(o => ({ v: o.v, label: o.label })), p[q.key], v => { p[q.key] = v; paramChanged(true); })));
        });
      }
      const reset = h('button', { class: 'action quiet', title: _T('Revenir aux valeurs par défaut') }, _T('Réinitialiser'));
      reset.addEventListener('click', () => { S.params = defaultParams(e); renderInspector(); });
      ins.appendChild(section(_T('Paramètres'), rows, reset));

      // Courbe
      if ((def && !def.noCurve) || e.kind === 'overlay') {
        const ccv = h('canvas', { class: 'curve-canvas' });
        const presetPick = picker(Object.keys(Core.CURVE_PRESETS).map(k => ({ v: k, label: Core.CURVE_PRESETS[k].label })).concat([{ v: 'custom', label: _T('Personnalisée') }]),
          curvePresetName(p.curve), v => { if (v !== 'custom') { p.curve = Core.curveValue(v); paramChanged(true); } });
        ins.appendChild(section(_T('Courbe'), [
          ccv,
          row(_T('Préréglage'), presetPick),
          h('div', { class: 'note' }, _T('Glisse les poignées. La moitié droite (POST) est le miroir de la gauche (PRE).'))
        ]));
        S.curveEd = CurveEditor(ccv, {
          get: () => p.curve,
          set: (c, fin) => { p.curve = c; presetPick.setValue(curvePresetName(c)); paramChanged(fin); },
          sides: () => activeSides(),
          frames: () => p.frames
        });
        requestAnimationFrame(() => S.curveEd && S.curveEd.draw());
      }
    }

    function curvePresetName(c) {
      for (const k in Core.CURVE_PRESETS) {
        if (Core.CURVE_PRESETS[k].v.every((x, i) => Math.abs(x - c[i]) < 0.005)) return k;
      }
      return 'custom';
    }

    async function saveAsPreset() {
      const e = S.cur;
      if (!e || e.kind === 'overlay') return;
      if (e.kind === 'captured') {
        const name = await promptName(_T('Dupliquer l\'effet capturé'), e.name + _T(' (copie)'));
        if (!name) return;
        const data = clone(e.item.data);
        if (S.params.frames !== data.frames && data.frames) {
          data.components.forEach(c => c.props.forEach(pr => { if (pr.values) pr.values = Core.fitValues(pr.values, S.params.frames, data.origin || 'post', S.params.stretch); }));
          data.frames = S.params.frames;
        }
        S.lib.items.push({ id: uid(), type: 'captured', name, cat: e.item.cat || 'mine', created: Date.now(), data });
        persist();
        renderGrid();
        status.finish('ok', _T('Enregistré : ') + name, _T('Dans « Mes effets ».'));
        return;
      }
      const name = await promptName(_T('Enregistrer comme preset'), e.kind === 'preset' ? e.name : e.name + _T(' perso'));
      if (!name) return;
      const data = { base: e.def.id, params: clone(S.params) };
      let item = S.lib.items.find(i => i.type === 'preset' && i.name === name);
      if (item) item.data = data;
      else {
        item = { id: uid(), type: 'preset', name, cat: e.def.cat, created: Date.now(), data };
        S.lib.items.push(item);
      }
      persist();
      renderGrid();
      selectEntry(entryByKey('u:' + item.id), true);
      status.finish('ok', _T('Preset enregistré : ') + name, _T('Retrouve-le dans la catégorie « Mes effets ».'));
    }

    // ---------------------------------------------------------------- appliquer un effet

    // Une entrée par zone (PRE/POST d'une coupe). Les deux côtés d'une même coupe
    // reçoivent le même effet tiré au hasard.
    // ---------------------------------------------------------------- enchaînement d'effets

    function chainEntries() {
      const all = entries(), c = settings().chain;
      return c.keys.map(k => all.find(x => x.key === k)).filter(Boolean);
    }
    const chainOn = () => {
      const st = settings();
      return isMulti(st.placement) && st.vary === 'chain' && chainEntries().length > 0;
    };
    function toggleChain(e) {
      const c = settings().chain, i = c.keys.indexOf(e.key);
      if (i >= 0) c.keys.splice(i, 1); else c.keys.push(e.key);
      if (settings().vary !== 'chain' && i < 0) settings().vary = 'chain';
      persist();
      renderGrid();
      renderInspector();
      renderCTA();
      const multi = isMulti(settings().placement);
      status.finish('ok', i >= 0 ? e.name + _T(' retiré de l\'enchaînement') : e.name + _T(' ajouté à l\'enchaînement'), plural(c.keys.length, _T('effet')) + ' : ' + chainEntries().map(x => x.name).join(' → ') + (multi ? '' : _T('. Choisis la position Temps forts, Marqueurs ou Toutes les coupes pour l\'appliquer.')));
    }

    function chainRow() {
      const c = settings().chain, list = chainEntries();
      const box = h('div', { class: 'chain' });
      list.forEach((x, i) => {
        const chip = h('span', { class: 'chain-chip', title: _T('Retirer') }, h('b', null, String(i + 1)), x.name, h('span', { class: 'chain-x' }, '✕'));
        chip.addEventListener('click', () => toggleChain(x));
        box.appendChild(chip);
      });
      const add = h('button', { class: 'action quiet', disabled: !S.cur || c.keys.includes(S.cur.key), title: _T('Ou Maj + clic sur une carte') }, '+ ' + (S.cur ? S.cur.name : _T('effet affiché')));
      add.addEventListener('click', () => S.cur && toggleChain(S.cur));
      box.appendChild(add);
      return [
        row(_T('Enchaînement'), box, { title: _T('Les effets se succèdent sur les coupes, marqueurs ou temps forts. Maj + clic sur une carte pour ajouter ou retirer.') }),
        list.length ? row(_T('Ordre'), actionGroup([{ v: 'cycle', label: _T('Dans l\'ordre') }, { v: 'random', label: _T('Au hasard') }], c.order, v => { c.order = v; persist(); })) : h('div', { class: 'note' }, _T('Ajoute 2 à 4 effets : Maj + clic sur les cartes, ou le bouton ci-dessus.'))
      ];
    }

    // Sons fournis : fabriqués une fois dans Documents/RRFX/Sons.
    const SFX_CHOICES = [{ v: 'none', label: _T('Aucun') }, { v: 'mix', label: _T('Whooshs variés + impacts sur les temps forts') }, { v: 'whoosh', label: 'Whoosh' }, { v: 'impact', label: _T('Hit court') }]
      .concat(Sons.SOUNDS.filter(x => !['whoosh', 'hit'].includes(x.id)).map(x => ({ v: x.id, label: x.name })));
    function ensureSound(id) {
      const snd = Sons.byId(id);
      if (!Store.fs) return 'RRFX ' + snd.name + '.wav';
      const dir = Store.path.join(Store.dir, 'Sons'), file = Store.path.join(dir, 'RRFX ' + snd.name + '.wav');
      if (!Store.fs.existsSync(file)) {
        Store.fs.mkdirSync(dir, { recursive: true });
        const w = Sons.wav(Sons.render(id));
        Store.fs.writeFileSync(file, Buffer.from(w.buffer, w.byteOffset, w.byteLength));
      }
      return file;
    }

    function buildPlan(e, targets, vary, rate, factors) {
      let pool = null;
      if (vary === 'favorites') {
        pool = entries().filter(isFav);
        if (!pool.length) log(_T('Aucun favori : effets tirés dans la même catégorie.'), 'warn');
      }
      if (vary === 'category' || (vary === 'favorites' && !pool.length)) pool = entries().filter(x => x.cat === e.cat);
      const chain = vary === 'chain' ? chainEntries() : null;
      const runSeed = Math.floor(Math.random() * 1000) + 1;
      const cutIndex = new Map();
      return targets.map(t => {
        const key = t.side === 'pre' ? t.end : t.start;
        if (!cutIndex.has(key)) cutIndex.set(key, cutIndex.size);
        const k = cutIndex.get(key);
        let entry = e, params = S.params;
        if (chain && chain.length) {
          // Enchaînement : les effets choisis tournent d'une coupe à l'autre (ou au hasard).
          entry = settings().chain.order === 'random' ? chain[Math.floor(Core.hash(k, runSeed) * chain.length) % chain.length] : chain[k % chain.length];
          params = Object.assign(defaultParams(entry), entry.kind === 'captured' ? { frames: S.params.frames } : { frames: S.params.frames, intensity: S.params.intensity });
        } else if (pool && pool.length) {
          entry = pool[Math.floor(Core.hash(k, runSeed) * pool.length) % pool.length];
          params = Object.assign(defaultParams(entry), entry.kind === 'captured' ? { frames: S.params.frames } : { frames: S.params.frames, intensity: S.params.intensity });
        }
        if (vary !== 'same' && params.seed !== undefined) params = Object.assign({}, params, { seed: ((params.seed + k * 17 + runSeed) % 99) + 1 });
        const f = factors ? factors.get(key) : 1;
        if (f && f !== 1 && params.intensity != null) params = Object.assign({}, params, { intensity: Core.clamp(Math.round(params.intensity * f), 0, 200) });
        // Zoom visage : les yeux suivis dans ce plan (sinon, des yeux typiques d'une face cam).
        if (t.face && entry.def && entry.def.face) params = Object.assign({}, params, { face: t.face });
        return {
          entry, mode: targetFor(entry), label: entry.name + ' ' + t.side.toUpperCase(),
          overlay: entry.kind === 'overlay' ? { path: entry.overlay.path, name: entry.overlay.name, kind: entry.overlay.kind, pack: entry.overlay.pack, start: params.start, seed: runSeed + k } : undefined,
          target: Object.assign({}, t, { name: 'RR FX · ' + entry.name, fx: Core.toWire(compileFor(entry, params, t.side, t.frames, rate)) })
        };
      });
    }

    function applyEffect() {
      const st = settings(), chained = chainOn();
      const e = chained ? Object.assign({}, chainEntries()[0], { name: _T('Enchaînement') }) : S.cur;
      if (!e) return null;
      const multi = isMulti(st.placement);
      return runTask(_T('Application · ') + e.name, async () => {
        status.phase(_T('Analyse de la timeline'));
        // Temps forts : détectés dans la musique, sans passer par des marqueurs.
        let times;
        if (st.placement === 'beats') {
          if (!app.services.beatTimes) return { kind: 'error', title: _T('Musique indisponible'), detail: _T('Onglet Musique introuvable.') };
          status.phase(_T('Temps forts de la musique'));
          times = await app.services.beatTimes();
          if (!times.length) return { kind: 'warn', title: _T('Aucun temps fort'), detail: _T('Règle la détection dans l\'onglet Musique (sensibilité, type).') };
        }
        const r = await Host.call('resolve', { placement: hostPlacement(st.placement), scope: st.placement === 'allcuts' || st.placement === 'allclips' ? 'sequence' : '', times, sides: activeSides(), frames: S.params.frames, target: targetFor(e) });
        if (!r.ok) {
          (r.warnings || []).forEach(w => log(w, 'warn'));
          return { kind: 'error', title: _T('Rien n\'a été appliqué'), detail: r.error };
        }
        // Intensité selon le volume de la musique à chaque coupe.
        let factors = null;
        if (st.volumeFollow && e.kind !== 'captured' && app.services.volumeFactors) {
          status.phase(_T('Volume de la musique'));
          try {
            const cuts = Array.from(new Set(r.targets.map(t => (t.side === 'pre' ? t.end : t.start))));
            const tps = 254016000000, vals = await app.services.volumeFactors(cuts.map(c => c / tps), st.volumeInfluence);
            factors = new Map(cuts.map((c, i) => [c, vals[i]]));
            log(_T('Intensité selon le volume : ') + vals.map(v => '×' + v.toFixed(2)).join(' '), 'info');
          } catch (err) {
            log(_T('Volume de la musique indisponible : ') + errorMessage(err), 'warn');
          }
        }
        // « Un plan sur deux » (punch-in sur les jump cuts) : un clip visé sur deux, dans l'ordre.
        if (isFull(st.placement) && st.alternate) r.targets = r.targets.slice().sort((a, b) => a.start - b.start).filter((t, i) => i % 2 === 1);
        if (!r.targets.length) return { kind: 'warn', title: _T('Un seul plan'), detail: _T('« Un plan sur deux » : sélectionne au moins deux clips.') };
        // Zoom visage / objet : le visage (ou l'objet entouré) est cherché dans chaque plan visé,
        // puis suivi image par image.
        let faceNote = '';
        const tracked = (chained ? chainEntries() : [e]).find(x => x.def && x.def.face);
        if (tracked && app.services.trackFaces) {
          const object = tracked.def.track === 'object';
          status.phase(object ? _T('Suivi de l\'objet') : _T('Recherche du visage'));
          const follow = S.params.follow || (tracked.def.id === 'face-stab' ? 'tight' : 'smooth');
          const tr = object ? await app.services.trackObject(r.targets, follow) : await app.services.trackFaces(r.targets, follow);
          r.targets.forEach((t, i) => { t.face = tr.faces[i]; });
          const found = tr.faces.filter(Boolean).length, what = object ? _T('Objet suivi') : _T('Visage suivi');
          faceNote = found === r.targets.length ? what + _T(' dans ') + plural(found, _T('plan')) + '.' : what + _T(' dans ') + found + _T(' plan(s) sur ') + r.targets.length + _T(' ; ailleurs, zoom vers le haut du cadre.');
          if (found < r.targets.length) log((object ? _T('Objet') : _T('Visage')) + _T(' introuvable dans ') + plural(r.targets.length - found, _T('plan')) + _T(' : zoom vers le haut du cadre') + (object ? '.' : _T(' (visage de face, assez grand et éclairé ?).')), 'warn');
        }
        const plan = buildPlan(e, r.targets, multi ? st.vary : 'same', r.fps, factors);
        if (!plan.some(x => x.target.fx.length)) return { kind: 'error', title: _T('Rien à appliquer'), detail: _T('Cet effet ne contient aucun réglage utilisable.') };
        // Overlays de pack : fabriqués une fois à la taille de la séquence.
        const packs = Array.from(new Set(plan.filter(x => x.overlay && x.overlay.pack).map(x => x.overlay.pack)));
        for (const id of packs) {
          const made = await buildPack(Packs.byId[id], r.fps || fps());
          if (!made) return { kind: 'warn', title: _T('Arrêté'), detail: _T('Overlay « ') + Packs.byId[id].name + _T(' » pas fabriqué.') };
          plan.forEach(x => { if (x.overlay && x.overlay.pack === id) Object.assign(x.overlay, { path: made.path, fps: made.fps }); });
        }

        status.phase(plan.length > 1 ? _T('Pose des effets') : _T('Pose de l\'effet'));
        const created = [], warnings = (r.warnings || []).slice();
        let done = 0, failed = 0, firstError = '';
        for (let i = 0; i < plan.length; i++) {
          if (S.cancel) break;
          status.progress(i, plan.length, plan[i].label);
          const res = await Host.call('apply', { target: plan[i].mode, name: plan[i].target.name, overlay: plan[i].overlay, targets: [plan[i].target], adjNodeId: st.adjNodeId, refreshAdj: i === 0, copyLook: st.copyLook });
          if (!res.ok) {
            failed++;
            firstError = firstError || res.error;
            log(plan[i].label + ' : ' + res.error, 'error');
            if (!done) break; // même cause à chaque coupe (pas de calque de réglage…) : inutile d'insister
            continue;
          }
          done++;
          created.push.apply(created, res.created || []);
          warnings.push.apply(warnings, res.warnings || []);
        }
        status.progress(plan.length, plan.length, '');
        // Sons sur les transitions (whooshs, impacts fournis), calés sur chaque coupe.
        let sounds = 0;
        if (st.sfx && st.sfx !== 'none' && done && !S.cancel) {
          status.phase(_T('Sons sur les transitions'));
          const cuts = Array.from(new Set(plan.map(x => (x.target.side === 'pre' ? x.target.end : x.target.start)))).sort((a, b) => a - b);
          const strong = factors ? cuts.map((c, i) => ((factors.get(c) || 1) > 1.15 ? i : -1)).filter(i => i >= 0) : cuts.map((c, i) => (i % 4 === 3 ? i : -1)).filter(i => i >= 0);
          for (const part of Sons.plan(cuts.map(c => c / 254016000000), st.sfx, strong)) {
            try {
              const snd = Sons.byId(part.id), res = await Host.call('placeAsset', { kind: 'audio', path: ensureSound(part.id), name: snd.name, times: part.times });
              if (res.ok) { created.push.apply(created, res.created); sounds += res.created.length; warnings.push.apply(warnings, res.warnings || []); } else warnings.push(_T('Sons : ') + res.error);
            } catch (err) { warnings.push(_T('Sons : ') + errorMessage(err)); }
          }
        }
        if (created.length) pushHistory({ date: Date.now(), label: multi ? e.name + ' × ' + done : e.name, entries: created });
        Array.from(new Set(warnings)).forEach(w => log(w, 'warn'));

        const what = plural(done, 'zone') + (sounds ? ' + ' + plural(sounds, _T('son')) : '');
        if (!done) return { kind: 'error', title: _T('Rien n\'a été appliqué'), detail: firstError };
        log(e.name + ' : ' + what + (failed ? ', ' + plural(failed, _T('échec')) : ''), failed ? 'warn' : 'ok');
        if (S.cancel) return { kind: 'warn', title: _T('Arrêté · ') + what + _T(' posée(s)'), detail: _T('Le reste n\'a pas été appliqué.') };
        if (failed) return { kind: 'warn', title: e.name + ' · ' + what + ', ' + plural(failed, _T('échec')), detail: firstError };
        if (warnings.length) return { kind: 'warn', title: e.name + _T(' appliqué · ') + what, detail: (faceNote ? faceNote + ' ' : '') + plural(new Set(warnings).size, _T('remarque')) + _T(' dans le journal.') };
        if (faceNote) return { kind: faceNote.includes('introuvable') || faceNote.includes(_T(' sur ')) ? 'warn' : 'ok', title: e.name + _T(' appliqué · ') + what, detail: faceNote };
        const on = { copy: _T('Sur une copie du plan (CLIP FX) au-dessus du clip.'), overlay: _T('Overlays posés au-dessus du clip.'), adjustment: _T('Sur des calques de réglage « RR FX · … ».') };
        return { kind: 'ok', title: e.name + _T(' appliqué · ') + what, detail: on[targetFor(e)] || on.adjustment };
      }, true);
    }

    Object.assign(core, { addOverlayList, applyEffect, chainEntries, chainOn, defaultParams, drawThumb, ensureSound, entries, entryByKey, fileURL, grabClean, grabRealFrames, pauseOverlayVideos, renderEffectsView, renderGrid, stopThumb });
  });
})();
