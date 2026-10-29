/* RR FX : le projet Premiere bien tenu.
   - Onglet Ressources : dossiers surveillés (les nouveaux fichiers d'un dossier arrivent tout
     seuls dans un chutier), rangement du projet (par type, médias inutilisés à part, rien n'est
     supprimé), renommage en série, proxies fabriqués par Media Encoder et attachés.
   - Onglet Formats : versions de la séquence (copies figées, rangées dans le chutier Versions). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils, { Host, Store } = app;
    const { h, picker, row, checkbox, actionGroup } = app.UI;
    const MEDIA = /\.(mov|mp4|m4v|mxf|avi|mts|m2ts|mkv|webm|r3d|braw|crm|insv|wav|mp3|aif|aiff|m4a|aac|flac|png|jpe?g|tiff?|psd|heic|webp)$/i;

    const st = () => {
      const s = app.settings();
      if (!s.projet || typeof s.projet !== 'object') s.projet = {};
      const d = { unused: true, pattern: '{nom}_###', start: 1, proxyPreset: '', proxyDir: '', proxyAll: false };
      Object.keys(d).forEach(k => { if (!(k in s.projet)) s.projet[k] = d[k]; });
      if (!Array.isArray(s.watch)) s.watch = [];
      return s.projet;
    };
    const watches = () => { st(); return app.settings().watch; };
    const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
    const binNames = () => ({ video: _T('Vidéos'), audio: _T('Sons'), image: _T('Images'), sequence: _T('Séquences'), graphic: _T('Graphiques'), unused: _T('Non utilisés') });

    // ---------------------------------------------------------------- dossiers surveillés

    const seen = new Map(); // dossier → fichiers déjà envoyés à Premiere (cette session)
    /* Nouveaux fichiers du dossier importés dans son chutier. → { imported: [noms], error } */
    async function scanWatch(w) {
      if (!Store.fs || !w.dir) return { imported: [] };
      const files = Store.listFiles(w.dir, MEDIA, 3000, 4), known = seen.get(w.dir) || new Set();
      const fresh = files.filter(f => !known.has(f));
      if (!fresh.length) return { imported: [] };
      const r = await Host.call('importToBin', { paths: fresh, bin: w.bin });
      if (!r.ok) { app.log(_T('Dossier surveillé « ') + base(w.dir) + _T(' » : ') + r.error, 'warn'); return { imported: [], error: r.error }; }
      fresh.forEach(f => known.add(f));
      seen.set(w.dir, known);
      if (r.imported.length) app.log(app.plural(r.imported.length, _T('fichier importé'), _T('fichiers importés')) + _T(' dans « ') + w.bin + _T(' » : ') + r.imported.slice(0, 5).join(', ') + (r.imported.length > 5 ? '…' : ''), 'ok');
      return { imported: r.imported };
    }
    const scanResult = (w, r) => (r.error ? { kind: 'error', title: _T('Import impossible'), detail: r.error }
      : r.imported.length ? { kind: 'ok', saved: r.imported.length, title: app.plural(r.imported.length, _T('fichier importé'), _T('fichiers importés')), detail: _T('Chutier « ') + w.bin + _T(' » · ') + r.imported.slice(0, 3).join(', ') + (r.imported.length > 3 ? '…' : '') }
        : { kind: 'ok', title: _T('Rien de nouveau'), detail: _T('Tout est déjà dans le projet.') });
    let watchTimer = 0;
    function startWatching() {
      clearInterval(watchTimer);
      if (!Store.fs || !watches().some(w => w.on !== false)) return;
      watchTimer = setInterval(async () => {
        if (app.S.busy || app.S.demo) return;
        for (const w of watches()) if (w.on !== false) { try { await scanWatch(w); } catch (e) { /* prochain tour */ } }
      }, 60000);
    }
    app.whenReady.push(() => { if (!app.S.demo) startWatching(); });

    function watchSection() {
      const box = h('div'), list = watches();
      if (!Store.fs) box.appendChild(h('div', { class: 'note' }, _T('Disponible dans Premiere (mode démo ici).')));
      if (!list.length) box.appendChild(h('div', { class: 'note' }, _T('Lie le dossier où arrivent tes rushs (carte mémoire copiée, dossier partagé avec ton client…) : chaque nouveau fichier est importé tout seul dans un chutier, toutes les minutes. Rien n\'est déplacé sur le disque.')));
      list.forEach(w => {
        const bin = h('input', { class: 'textfield', value: w.bin, 'aria-label': _T('Chutier') });
        bin.addEventListener('change', () => { w.bin = bin.value.trim() || base(w.dir); app.persist(); });
        const now = h('button', { class: 'action' }, _T('Importer maintenant'));
        now.addEventListener('click', () => app.runTask(_T('Dossier surveillé'), async () => scanResult(w, await scanWatch(w))));
        const off = h('button', { class: 'action quiet danger' }, _T('Retirer'));
        off.addEventListener('click', () => { list.splice(list.indexOf(w), 1); seen.delete(w.dir); app.persist(); startWatching(); app.switchTab('assets'); });
        box.appendChild(h('div', { class: 'watch-item' },
          h('div', { class: 'watch-dir', title: w.dir }, '📂 ' + base(w.dir)),
          row(_T('Chutier'), bin),
          checkbox(_T('Surveiller (toutes les minutes)'), w.on !== false, v => { w.on = v; app.persist(); startWatching(); }),
          h('div', { class: 'row-buttons' }, now, off)));
      });
      const add = h('button', { class: 'action' + (list.length ? '' : ' go'), disabled: !Store.fs }, _T('＋ Surveiller un dossier…'));
      add.addEventListener('click', () => {
        const dirs = Store.pickFiles(_T('Dossier à surveiller'), [], true);
        if (!dirs || !dirs.length) return;
        const w = { dir: dirs[0], bin: _T('Rushs') + '/' + base(dirs[0]), on: true };
        list.push(w);
        app.persist();
        startWatching();
        app.runTask(_T('Dossier surveillé'), async () => scanResult(w, await scanWatch(w)));
        app.switchTab('assets');
      });
      box.appendChild(h('div', { class: 'row-buttons' }, add));
      return [box];
    }

    // ---------------------------------------------------------------- rangement

    function tidy(dry, out) {
      const x = st();
      return app.runTask(dry ? _T('Inventaire du projet') : _T('Rangement du projet'), async () => {
        const r = await Host.call('tidyProject', { dry, unused: x.unused, names: binNames() });
        if (!r.ok) return { kind: 'error', title: _T('Projet non rangé'), detail: r.error };
        const N = binNames(), what = Object.keys(r.counts).filter(k => r.counts[k]).map(k => r.counts[k] + ' → ' + N[k]).join(', ');
        if (dry) {
          if (out) out.textContent = (what ? _T('En vrac à la racine : ') + what + '. ' : _T('Rien en vrac à la racine. ')) + (x.unused ? (r.unusedCount ? app.plural(r.unusedCount, _T('média jamais utilisé'), _T('médias jamais utilisés')) + ' : ' + r.unused.slice(0, 6).join(', ') + (r.unusedCount > 6 ? '…' : '') + '.' : _T('Tous les médias servent dans une séquence.')) : '');
          return { kind: 'ok', title: _T('Inventaire fait'), detail: _T('Rien n\'a bougé.') };
        }
        if (out) out.textContent = '';
        return { kind: 'ok', saved: r.moved + r.parked, title: app.plural(r.moved + r.parked, _T('élément rangé'), _T('éléments rangés')), detail: (what || _T('Rien en vrac')) + (r.parked ? ' · ' + r.parked + ' → ' + N.unused : '') + _T('. Rien n\'est supprimé : glisse un élément pour le ranger ailleurs.') };
      });
    }
    function tidySection() {
      const x = st(), out = h('div', { class: 'note' });
      const look = h('button', { class: 'action' }, _T('Voir ce qui sera rangé'));
      look.addEventListener('click', () => tidy(true, out));
      const go = h('button', { class: 'action go' }, _T('Ranger le projet'));
      go.addEventListener('click', () => tidy(false, out));
      return [
        h('div', { class: 'note' }, _T('Ce qui traîne à la racine du panneau Projet part dans des chutiers : Vidéos, Sons, Images, Séquences, Graphiques. Tes chutiers à toi ne bougent pas.')),
        checkbox(_T('Ranger à part les médias jamais utilisés (chutier « Non utilisés »)'), x.unused, v => { x.unused = v; app.persist(); }),
        h('div', { class: 'row-buttons' }, go, look), out
      ];
    }

    // ---------------------------------------------------------------- renommage en série

    async function selection() {
      const r = await Host.call('renameItems', { dry: true });
      if (!r.ok) throw new Error(r.error);
      return r.items;
    }
    function rename(out) {
      const x = st();
      return app.runTask(_T('Renommage en série'), async () => {
        const items = await selection(), names = O.renamePlan(items.map(i => i.name), x.pattern, x.start);
        const r = await Host.call('renameItems', { ids: items.map(i => i.id), names });
        if (!r.ok) return { kind: 'error', title: _T('Rien de renommé'), detail: r.error };
        app.pushHistory({ date: Date.now(), label: _T('Renommage × ') + r.renamed.length, entries: r.renamed.map(q => ({ kind: 'rename', id: q.id, old: q.old, name: q.name })) });
        if (out) out.textContent = '';
        return { kind: 'ok', title: app.plural(r.renamed.length, _T('élément renommé'), _T('éléments renommés')), detail: r.renamed.slice(0, 3).map(q => q.old + ' → ' + q.name).join(', ') + (r.renamed.length > 3 ? '…' : '') + _T('. ↶ Annuler remet les anciens noms.') };
      });
    }
    function renameSection() {
      const x = st(), out = h('div', { class: 'note' });
      const pat = h('input', { class: 'textfield', value: x.pattern, placeholder: '{nom}_###', 'aria-label': _T('Modèle de nom') });
      pat.addEventListener('input', () => { x.pattern = pat.value; app.persist(); });
      const start = h('input', { class: 'textfield', type: 'number', min: 0, value: x.start, 'aria-label': _T('Premier numéro') });
      start.addEventListener('change', () => { x.start = Math.max(0, Math.round(+start.value) || 0); app.persist(); });
      const look = h('button', { class: 'action' }, _T('Aperçu'));
      look.addEventListener('click', async () => {
        try {
          const items = await selection(), names = O.renamePlan(items.map(i => i.name), x.pattern, x.start);
          out.textContent = items.slice(0, 4).map((i, k) => i.name + ' → ' + names[k]).join(' · ') + (items.length > 4 ? ' … (' + items.length + ')' : '');
        } catch (e) { out.textContent = app.errorMessage(e); }
      });
      const go = h('button', { class: 'action go' }, _T('Renommer la sélection'));
      go.addEventListener('click', () => rename(out));
      return [
        h('div', { class: 'note' }, _T('Sélectionne des éléments dans le panneau Projet. « # » devient le numéro (### → 001, 002…), {nom} le nom actuel. Les fichiers sur le disque ne changent pas.')),
        row(_T('Modèle'), pat), row(_T('À partir de'), start),
        h('div', { class: 'row-buttons' }, go, look), out
      ];
    }

    // ---------------------------------------------------------------- proxies

    let presets = null, poll = 0;
    async function loadPresets(redraw) {
      const r = await Host.call('proxyPresets', {});
      presets = r.ok ? r.presets : [];
      const x = st();
      if (!x.proxyPreset && presets.length) x.proxyPreset = (presets.find(p => /H\.?264/i.test(p.name)) || presets[0]).path;
      if (redraw) redraw();
    }
    function watchProxies(total) {
      clearInterval(poll);
      poll = setInterval(async () => {
        const r = await Host.call('proxyStatus', {});
        if (!r.ok) { clearInterval(poll); return; }
        if (!app.S.busy) app.status.finish(r.finished >= r.total ? 'ok' : 'idle', r.finished >= r.total ? app.plural(r.attached, _T('proxy attaché'), _T('proxies attachés')) : _T('Proxies : ') + r.finished + '/' + r.total, r.finished >= r.total ? _T('Moniteur de programme > bouton « Activer les proxies » pour monter avec. L\'export utilise toujours les originaux.') : _T('Media Encoder les fabrique ; RR FX les attache au fur et à mesure.'));
        if (r.finished >= r.total) clearInterval(poll);
      }, 3000);
    }
    function proxies() {
      const x = st();
      return app.runTask(_T('Proxies'), async () => {
        if (!x.proxyPreset) return { kind: 'error', title: _T('Préréglage manquant'), detail: _T('Choisis un préréglage de proxy (fichier .epr).') };
        const dir = x.proxyDir || (Store.path ? Store.path.join(Store.dir || '', 'Proxies') : '/RRFX/Proxies');
        const r = await Host.call('makeProxies', { preset: x.proxyPreset, dir, all: x.proxyAll });
        if (!r.ok) return { kind: 'error', title: _T('Proxies non lancés'), detail: r.error };
        if (!r.queued.length) return { kind: 'warn', title: _T('Aucun proxy à faire'), detail: r.skipped ? app.plural(r.skipped, _T('rush a déjà son proxy (ou n\'en accepte pas)'), _T('rushs ont déjà leur proxy (ou n\'en acceptent pas)')) + '.' : '' };
        watchProxies(r.queued.length);
        return { kind: 'ok', saved: r.queued.length * 2, title: app.plural(r.queued.length, _T('proxy en file'), _T('proxies en file')) + _T(' dans Media Encoder'), detail: _T('Dossier : ') + dir + _T('. Ils s\'attachent tout seuls quand Media Encoder a fini.') + (r.skipped ? ' ' + app.plural(r.skipped, _T('rush passé'), _T('rushs passés')) + _T(' (déjà un proxy).') : '') };
      });
    }
    function proxySection() {
      const x = st(), box = h('div');
      const draw = () => {
        box.innerHTML = '';
        box.appendChild(h('div', { class: 'note' }, _T('Rushs 4K, 6K ou LOG trop lourds pour ton ordinateur ? RR FX fait fabriquer des proxies légers par Media Encoder et les attache : le montage est fluide, l\'export garde les originaux.')));
        if (!presets) { loadPresets(draw); box.appendChild(h('div', { class: 'note' }, _T('Recherche des préréglages…'))); return; }
        const opts = presets.map(p => ({ v: p.path, label: p.name }));
        if (x.proxyPreset && !opts.some(o => o.v === x.proxyPreset)) opts.push({ v: x.proxyPreset, label: base(x.proxyPreset).replace(/\.epr$/i, '') });
        if (opts.length) box.appendChild(row(_T('Préréglage'), picker(opts, x.proxyPreset, v => { x.proxyPreset = v; app.persist(); })));
        else box.appendChild(h('div', { class: 'note' }, _T('Aucun préréglage de proxy trouvé dans Premiere : choisis un fichier .epr.')));
        const pick = h('button', { class: 'action quiet', disabled: !Store.fs }, _T('Autre préréglage (.epr)…'));
        pick.addEventListener('click', () => { const f = Store.pickFiles(_T('Préréglage de proxy'), ['epr']); if (f && f[0]) { x.proxyPreset = f[0]; app.persist(); draw(); } });
        const dir = h('button', { class: 'action quiet', disabled: !Store.fs }, x.proxyDir ? '📂 ' + base(x.proxyDir) : _T('Dossier des proxies…'));
        dir.addEventListener('click', () => { const d = Store.pickFiles(_T('Dossier des proxies'), [], true); if (d && d[0]) { x.proxyDir = d[0]; app.persist(); draw(); } });
        box.appendChild(row(_T('Rushs'), actionGroup([{ v: false, label: _T('Sélection du Projet') }, { v: true, label: _T('Tous les rushs vidéo') }], x.proxyAll, v => { x.proxyAll = v; app.persist(); })));
        const go = h('button', { class: 'action go' }, _T('Créer les proxies'));
        go.addEventListener('click', proxies);
        box.appendChild(h('div', { class: 'row-buttons wrap' }, go, pick, dir));
        box.appendChild(h('div', { class: 'note' }, _T('Dossier : ') + (x.proxyDir || _T('Documents/RRFX/Proxies')) + _T('. Media Encoder doit être installé (Creative Cloud).')));
      };
      draw();
      return [box];
    }

    app.extras.assets.push(
      { id: 'surveilles', title: _T('Dossiers surveillés'), nav: _T('Surveillés'), shut: !watches().length, render: watchSection },
      { id: 'rangement', title: _T('Ranger le projet'), nav: _T('Ranger'), shut: true, render: tidySection },
      { id: 'renommer', title: _T('Renommer en série'), nav: _T('Renommer'), shut: true, render: renameSection },
      { id: 'proxies', title: _T('Proxies'), nav: 'Proxies', shut: true, render: proxySection }
    );

    // ---------------------------------------------------------------- versions de la séquence

    async function snapshot(note) {
      const l = await Host.call('listSequences', {});
      if (!l.ok) return l;
      const cur = l.sequences.find(q => q.id === l.active);
      if (!cur) return { ok: false, error: _T('Aucune séquence active') };
      const name = O.versionName(cur.name, l.sequences.map(q => q.name)) + (note ? ' (' + note + ')' : '');
      const r = await Host.call('versionSequence', { name, bin: _T('Versions') });
      if (r.ok) app.log(_T('Version gardée : ') + r.name, 'ok');
      return r;
    }
    function keepVersion(note, refresh) {
      return app.runTask(_T('Version de la séquence'), async () => {
        const r = await snapshot(note);
        if (!r.ok) return { kind: 'error', title: _T('Version non gardée'), detail: r.error };
        if (refresh) refresh();
        return { kind: 'ok', title: _T('Version gardée : ') + r.name, detail: _T('Copie figée dans le chutier Versions. Tu continues sur « ') + r.of + _T(' ».') };
      });
    }
    app.extras.formats.push({
      id: 'versions', title: _T('Versions de la séquence'), nav: _T('Versions'),
      render: () => {
        const box = h('div'), listBox = h('div', { class: 'seq-list' });
        const note = h('input', { class: 'textfield', placeholder: _T('Note (facultatif) : avant retours client, V1 validée…'), 'aria-label': _T('Note de la version') });
        const draw = async () => {
          listBox.innerHTML = '';
          const l = await Host.call('listSequences', {});
          if (!l.ok) return;
          const cur = l.sequences.find(q => q.id === l.active);
          const vs = cur ? O.versionsOf(cur.name, l.sequences) : [];
          if (!vs.length) { listBox.appendChild(h('div', { class: 'note' }, _T('Aucune version de « ') + (cur ? cur.name : '…') + _T(' » pour l\'instant.'))); return; }
          vs.forEach(v => {
            const open = h('button', { class: 'action quiet' }, _T('Ouvrir'));
            open.addEventListener('click', async () => { const r = await Host.call('openSequence', { id: v.id }); app.status.finish(r.ok ? 'ok' : 'error', r.ok ? _T('Version ouverte : ') + v.name : _T('Version introuvable'), r.ok ? _T('La séquence de travail reste dans le panneau Projet.') : r.error); });
            listBox.appendChild(h('div', { class: 'ver-item' }, h('span', null, '🕓 ' + v.name), open));
          });
        };
        const go = h('button', { class: 'action go' }, _T('Garder une version maintenant'));
        go.addEventListener('click', () => { keepVersion(note.value.trim(), draw); note.value = ''; });
        draw();
        box.append(
          h('div', { class: 'note' }, _T('Avant un gros changement ou des retours client : une copie figée de la séquence (« Clip v02 »), rangée dans le chutier Versions. Tu continues sur l\'originale, et tu peux rouvrir une version à tout moment.')),
          note, h('div', { class: 'row-buttons' }, go), listBox);
        return [box];
      }
    });

    app.versions = { snapshot };
    app.actions.keepVersion = () => keepVersion('');
    app.actions.tidyProject = () => tidy(false);
    app.actions.proxies = () => proxies();
  });
})(typeof self !== 'undefined' ? self : this);
