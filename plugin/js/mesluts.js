/* RR FX : Mes LUTs (onglet Couleur). Toutes tes LUTs au même endroit, pour tous tes projets :
   importées une fois (copiées dans Documents/RRFX/Mes LUTs), plus celles de tes dossiers liés
   (onglet Ressources). Vignette de chaque LUT sur ton image, recherche, favoris, avant/après, et
   un clic pour la poser sur un calque Lumetri (le clip visé ou toute la séquence). */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const A = root.RRFXAssets, D = root.RRFXDevelop, { Store, Pv } = app;
    const { h, actionGroup, row } = app.UI;
    const EXTS = ['cube', '3dl', 'look', 'lut', 'csp'];
    const PAGE = 48;

    const st = () => {
      const s = app.settings();
      if (!s.lutLib || typeof s.lutLib !== 'object') s.lutLib = {};
      const d = { favs: [], search: '', favOnly: false, target: 'clip', sel: '' };
      Object.keys(d).forEach(k => { if (!(k in s.lutLib)) s.lutLib[k] = d[k]; });
      return s.lutLib;
    };
    const dir = () => (Store.fs ? Store.path.join(Store.dir, 'Mes LUTs') : null);
    const extOf = f => (/\.([a-z0-9]+)$/i.exec(f) || [0, ''])[1].toLowerCase();

    /* Toutes les LUTs : les tiennes (dossier Mes LUTs), celles des dossiers liés, et en mode démo
       des LUTs d'exemple tirées des looks fournis. → [{ id, name, path, ext, from, lut? }] */
    function list() {
      const out = [], seen = new Set();
      const add = e => { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } };
      const d = dir();
      if (d) Store.listFiles(d, /\.(cube|3dl|look|lut|csp)$/i, 3000, 2).forEach(p => add({ id: p, name: Store.path.basename(p).replace(/\.[^.]+$/, ''), path: p, ext: extOf(p), from: 'mine' }));
      if (app.services.resourceLuts) app.services.resourceLuts().forEach(e => add({ id: e.path, name: e.name, path: e.path, ext: e.ext || extOf(e.path), from: e.rootName || 'dossier lié' }));
      if (!out.length && app.S.demo && D) D.LOOKS.forEach(l => add({ id: 'demo:' + l.name, name: l.name, path: '', ext: 'cube', from: 'exemple', lut: D.buildLut(D.normalize(JSON.parse(JSON.stringify(l.p))), 17) }));
      return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }

    // Liste relue à chaque ouverture de l'onglet et après un import, pas à chaque recherche.
    let listed = null;
    const entries = () => listed || (listed = list());

    // LUT .cube lue une fois (les autres formats : pas d'aperçu, mais Lumetri les accepte). Une
    // à la fois, en rendant la main entre deux : le panneau reste fluide avec de grosses LUTs.
    const cache = new Map();
    let queue = Promise.resolve();
    function lutOf(e) {
      if (e.lut) return Promise.resolve(e.lut);
      if (e.ext !== 'cube' || !Store.fs || !e.path) return Promise.resolve(null);
      if (!cache.has(e.id)) cache.set(e.id, queue = queue.then(() => new Promise(r => setTimeout(r, 0))).then(() => A.parseCube(Store.fs.readFileSync(e.path, 'utf8'))).catch(() => null));
      return cache.get(e.id);
    }
    const thumbs = new Map();
    function thumb(e, w, hh) {
      const cv = h('canvas', { width: w, height: hh, class: 'lut-thumb' }), g = cv.getContext('2d');
      const key = e.id + '|' + w + '|' + (Pv.isReal() ? 'r' : 't');
      if (thumbs.has(key)) { g.putImageData(thumbs.get(key), 0, 0); return cv; }
      g.drawImage(Pv.shots()[Pv.isReal() ? 'B' : 'A'], 0, 0, w, hh);
      lutOf(e).then(lut => {
        if (!lut) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, hh - 16, w, 16); g.fillStyle = '#fff'; g.font = '10px sans-serif'; g.fillText('.' + e.ext + ' · sans aperçu', 4, hh - 5); return; }
        const d = g.getImageData(0, 0, w, hh);
        A.applyLut(d.data, lut);
        g.putImageData(d, 0, 0);
        thumbs.set(key, d);
      });
      return cv;
    }

    // ---------------------------------------------------------------- import

    function copyIn(files) {
      const d = dir();
      if (!d) throw new Error('Disponible dans Premiere.');
      Store.fs.mkdirSync(d, { recursive: true });
      let n = 0;
      files.forEach(f => {
        const base = f.name.replace(/\.[^.]+$/, ''), ext = f.ext || extOf(f.name);
        let out = Store.path.join(d, base + '.' + ext), k = 2;
        // Même nom, contenu différent : on garde les deux.
        while (Store.fs.existsSync(out) && Store.fs.statSync(out).size !== (f.bytes ? f.bytes.length : Store.fs.statSync(f.path).size)) out = Store.path.join(d, base + ' (' + k++ + ').' + ext);
        if (Store.fs.existsSync(out)) return;
        if (f.bytes) Store.fs.writeFileSync(out, Buffer.from(f.bytes)); else Store.fs.copyFileSync(f.path, out);
        n++;
      });
      thumbs.clear();
      listed = null;
      return { n, what: 'dans Mes LUTs (onglet Couleur)' };
    }
    async function importFiles(refresh) {
      const files = await app.services.pickFiles('Importer des LUTs', EXTS);
      if (!files.length) return;
      try { const r = copyIn(files); refresh(); app.status.finish('ok', app.plural(r.n, 'LUT ajoutée', 'LUTs ajoutées'), r.n < files.length ? (files.length - r.n) + ' déjà dans Mes LUTs.' : 'Disponibles dans tous tes projets.'); } catch (e) { app.status.finish('warn', 'LUTs non importées', app.errorMessage(e)); }
    }
    function importFolder(refresh) {
      const dirs = Store.pickFiles('Importer un dossier de LUTs', [], true);
      if (dirs === null) return app.status.finish('warn', 'Disponible dans Premiere', 'Le choix du dossier passe par Premiere.');
      if (!dirs.length) return;
      const paths = Store.listFiles(dirs[0], /\.(cube|3dl|look|lut|csp)$/i, 3000, 6);
      if (!paths.length) return app.status.finish('warn', 'Aucune LUT dans ce dossier', dirs[0]);
      const r = copyIn(paths.map(p => ({ name: Store.path.basename(p), ext: extOf(p), path: p })));
      refresh();
      app.status.finish('ok', app.plural(r.n, 'LUT ajoutée', 'LUTs ajoutées'), 'Depuis ' + dirs[0] + '.');
    }

    // ---------------------------------------------------------------- appliquer

    function apply(e) {
      const s = st();
      return app.runTask('LUT · ' + e.name, async () => {
        if (!e.path) return { kind: 'warn', title: 'LUT d\'exemple', detail: 'Importe tes propres LUTs (.cube) pour les poser dans Premiere.' };
        const { res, fail } = await app.services.adjustmentLayer('RR FX · LUT ' + e.name, await app.services.lumetriFx(e.path), { scope: s.target, history: 'LUT · ' + e.name });
        if (fail) return fail;
        return { kind: res.lutSet ? res.kind : 'warn', title: 'LUT « ' + e.name + ' » posée', detail: res.lutSet ? 'Calque Lumetri, LUT d\'entrée chargée. ↶ Annuler la retire.' : 'Calque Lumetri posé : charge la LUT dans Correction de base > LUT d\'entrée (' + e.path + ').' };
      });
    }

    // ---------------------------------------------------------------- panneau

    function panel(makePanel) {
      const box = h('div');
      listed = null;
      let shown = PAGE;
      const refresh = () => {
        const s = st(), all = entries(), q = s.search.trim().toLowerCase();
        const rows = all.filter(e => (!q || e.name.toLowerCase().includes(q)) && (!s.favOnly || s.favs.indexOf(e.id) >= 0));
        box.innerHTML = '';
        const search = h('input', { class: 'textfield', placeholder: 'Rechercher parmi ' + app.plural(all.length, 'LUT'), value: s.search });
        search.addEventListener('input', () => { s.search = search.value; app.persist(); clearTimeout(search.t); search.t = setTimeout(() => { refresh(); const f = box.querySelector('input.textfield'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 250); });
        const fav = h('button', { class: 'action icon' + (s.favOnly ? ' on' : ''), title: 'Seulement les favorites' }, '★');
        fav.addEventListener('click', () => { s.favOnly = !s.favOnly; app.persist(); refresh(); });
        box.appendChild(h('div', { class: 'search-row' }, search, fav));
        const imp = h('button', { class: 'action go' }, 'Importer des LUTs…');
        imp.addEventListener('click', () => importFiles(refresh));
        const folder = h('button', { class: 'action' }, 'Importer un dossier…');
        folder.addEventListener('click', () => importFolder(refresh));
        const open = h('button', { class: 'action quiet', title: 'Ouvrir le dossier Mes LUTs' }, '📂');
        open.addEventListener('click', () => { const d = dir(); if (d) { Store.fs.mkdirSync(d, { recursive: true }); Store.reveal ? Store.reveal(d) : Store.openFolder(); } });
        box.appendChild(h('div', { class: 'row-buttons' }, imp, folder, open));
        if (!all.length) { box.appendChild(h('div', { class: 'note' }, 'Importe tes LUTs une fois (.cube, .3dl, .look…) : elles restent ici pour tous tes projets, avec un aperçu sur ton image. Les LUTs de tes dossiers liés (onglet Ressources) apparaissent aussi.')); return; }
        const sel = rows.find(e => e.id === s.sel) || rows[0];
        if (sel) {
          // Grand aperçu : maintenir le clic pour voir l'avant.
          const big = thumb(sel, 320, 180);
          big.classList.add('lut-big');
          const before = h('canvas', { width: 320, height: 180, class: 'lut-thumb lut-big lut-before' });
          before.getContext('2d').drawImage(Pv.shots()[Pv.isReal() ? 'B' : 'A'], 0, 0, 320, 180);
          const stage = h('div', { class: 'lut-stage', title: 'Maintiens le clic pour voir l\'avant' }, big, before);
          stage.addEventListener('pointerdown', () => stage.classList.add('show-before'));
          ['pointerup', 'pointerleave'].forEach(ev => stage.addEventListener(ev, () => stage.classList.remove('show-before')));
          const go = h('button', { class: 'action go' }, 'Appliquer');
          go.addEventListener('click', () => apply(sel));
          const star = h('button', { class: 'action icon' + (s.favs.indexOf(sel.id) >= 0 ? ' on' : ''), title: 'Favorite' }, '★');
          star.addEventListener('click', () => { const i = s.favs.indexOf(sel.id); if (i >= 0) s.favs.splice(i, 1); else s.favs.push(sel.id); app.persist(); refresh(); });
          const del = sel.from === 'mine' ? h('button', { class: 'action quiet danger', title: 'Retirer de Mes LUTs (le fichier est supprimé du dossier Mes LUTs)' }, '✕') : null;
          if (del) del.addEventListener('click', async () => {
            if (!(await app.confirmDialog('Retirer « ' + sel.name + ' » ?', 'Le fichier est supprimé du dossier Mes LUTs.', 'Retirer'))) return;
            try { Store.fs.unlinkSync(sel.path); } catch (err) { app.log(app.errorMessage(err), 'warn'); }
            listed = null;
            refresh();
          });
          box.appendChild(stage);
          box.appendChild(h('div', { class: 'lut-sel' }, h('b', null, sel.name), h('span', { class: 'note' }, ' · ' + (sel.from === 'mine' ? 'Mes LUTs' : sel.from) + ' · .' + sel.ext)));
          box.appendChild(row('Sur', actionGroup([{ v: 'clip', label: 'Clip visé' }, { v: 'sequence', label: 'Toute la séquence' }], s.target, v => { s.target = v; app.persist(); })));
          box.appendChild(h('div', { class: 'row-buttons' }, go, star, del));
        }
        const grid = h('div', { class: 'lut-grid' });
        rows.slice(0, shown).forEach(e => {
          const card = h('button', { class: 'lut-card' + (sel && e.id === sel.id ? ' on' : ''), title: e.name + (e.from !== 'mine' ? ' · ' + e.from : '') }, thumb(e, 120, 68), h('span', null, (s.favs.indexOf(e.id) >= 0 ? '★ ' : '') + e.name));
          card.addEventListener('click', () => { s.sel = e.id; app.persist(); refresh(); });
          card.addEventListener('dblclick', () => apply(e));
          grid.appendChild(card);
        });
        box.appendChild(grid);
        if (rows.length > shown) {
          const more = h('button', { class: 'action quiet' }, 'Afficher plus (' + (rows.length - shown) + ')');
          more.addEventListener('click', () => { shown += PAGE; refresh(); });
          box.appendChild(more);
        }
        box.appendChild(h('div', { class: 'note' }, 'Double-clic sur une LUT : appliquée tout de suite. 📷 « Ma vraie image » (en haut) montre les vignettes sur ta séquence.'));
      };
      refresh();
      return makePanel('luts', 'Mes LUTs', [box]);
    }

    app.importers.push({ exts: EXTS, label: 'LUTs', run: files => copyIn(files) });
    app.lutLibrary = { panel, list, apply };
  });
})(typeof self !== 'undefined' ? self : this);
