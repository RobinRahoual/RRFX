/* RR FX : onglet Mes effets : capture, bibliothèque perso (import, export, partage) et bibliothèque
   de la communauté.
   Découpé de main.js : l'état et les services communs arrivent par « core ». */
(function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (window.RRFXPanels = window.RRFXPanels || []).push(function (core) {
    const Community = window.RRFXCommunity, Host = window.RRFXHost, Lib = window.RRFXLibrary, Pv = window.RRFXPreview, Share = window.RRFXShare, Store = window.RRFXStorage;
    const { actionGroup, checkbox, h, picker, row, section } = window.RRFXUI;
    const { $, status, S, app, catLabel, clone, defaultParams, drawThumb, entries, entryByKey, errorMessage, log,
      modal, persist, plural, promptName, ramp, renderCTA, runTask, storage, switchTab, uid } = core;

    // ---------------------------------------------------------------- onglet Mes effets

    const captureOpts = { name: '', cat: 'mine', intrinsic: false };

    function renderMineView() {
      const view = $('view-mine');
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'mine-switch' }, actionGroup([{ v: 'mine', label: _T('Ma bibliothèque') }, { v: 'community', label: _T('🌐 Communauté') }], S.mineView, v => { S.mineView = v; renderMineView(); renderCTA(); })));
      if (S.mineView === 'community') { renderCommunity(view); return; }
      const nameIn = h('input', { class: 'textfield', placeholder: _T('Nom (par défaut : nom du clip)'), value: captureOpts.name });
      nameIn.addEventListener('input', () => { captureOpts.name = nameIn.value; });
      view.appendChild(section(_T('Capturer un effet'), [
        h('div', { class: 'note' }, _T('Monte ton effet dans Premiere (sur un clip ou un calque de réglage, avec ses images clés, effets tiers compris), sélectionne-le dans la timeline puis clique sur « Capturer la sélection » en haut. Effets, valeurs et animations sont enregistrés et réutilisables comme les effets intégrés.')),
        row(_T('Nom'), nameIn),
        row(_T('Catégorie'), picker([{ v: 'mine', label: _T('Mes effets') }].concat(Lib.CATEGORIES.map(c => ({ v: c.id, label: c.label }))), captureOpts.cat, v => { captureOpts.cat = v; })),
        h('div', { class: 'field' }, checkbox(_T('Inclure Trajectoire et Opacité'), captureOpts.intrinsic, v => { captureOpts.intrinsic = v; }))
      ]));

      const imp = h('button', { class: 'action go', title: _T('Presets (.json), packs (.rrfxpack), LUTs (.cube), couleurs (.ase), modèles de texte (.mogrt)…') }, _T('Importer…'));
      imp.addEventListener('click', importItems);
      const exp = h('button', { class: 'action' }, _T('Tout exporter…'));
      exp.addEventListener('click', () => exportItems(S.lib.items, 'RRFX-bibliotheque.json'));
      const shareAll = h('button', { class: 'action' }, _T('Tout partager'));
      shareAll.addEventListener('click', () => shareItems(S.lib.items, _T('Ma bibliothèque')));
      const paste = h('button', { class: 'action' }, _T('Coller un code…'));
      paste.addEventListener('click', pasteCode);
      view.appendChild(section(_T('Ma bibliothèque'), [h('div', { id: 'mine-filter' }), h('div', { id: 'mine-list' }), h('div', { class: 'row-buttons' }, imp, exp), h('div', { class: 'row-buttons' }, paste, shareAll), h('div', { class: 'note' }, _T('« Importer… » reconnaît tout seul ce que tu lui donnes : presets et exports RR FX (.json), packs (.rrfxpack), LUTs (.cube, .3dl…), nuanciers (.ase), modèles de texte (.mogrt). « Tout partager » donne un code à envoyer en message. Bibliothèque enregistrée dans : ') + Store.location)]));
      if (app.stylePacks) view.appendChild(app.stylePacks.section());
      renderMineList();
    }

    function capture() {
      return runTask('Capture', async () => {
        status.phase(_T('Lecture des effets du clip sélectionné'));
        const r = await Host.call('capture', { includeIntrinsic: captureOpts.intrinsic });
        if (!r.ok) return { kind: 'error', title: _T('Capture impossible'), detail: r.error };
        const data = Object.assign({}, r);
        delete data.ok;
        const item = { id: uid(), type: 'captured', name: captureOpts.name.trim() || r.name, cat: captureOpts.cat, created: Date.now(), data };
        S.lib.items.push(item);
        persist();
        captureOpts.name = '';
        if (S.tab === 'mine') renderMineView();
        const n = r.components.length;
        log(_T('Capturé : ') + item.name + ' · ' + plural(n, _T('effet')) + (r.frames ? ' · ' + r.frames + _T(' images animées') : '') + (r.skipped ? ' · ' + r.skipped + _T(' paramètre(s) illisible(s) ignoré(s)') : ''), r.skipped ? 'warn' : 'ok');
        return { kind: 'ok', title: _T('Capturé : ') + item.name, detail: plural(n, _T('effet')) + (r.frames ? ' · ' + plural(r.frames, _T('image animée'), _T('images animées')) : _T(' · sans animation')) + _T(' · catégorie « ') + catLabel(item.cat) + _T(' »') };
      });
    }

    /* Types d'éléments de la bibliothèque (Mes effets). Chaque module ajoute les siens
       (animations de texte, styles de texte, couleurs, dégradés, styles Express…) : ils
       s'importent, s'exportent, se partagent par code et se publient tous de la même façon.
       icon, label ; valid(data) : contenu acceptable ; meta(item) : détail ; open(item). */
    const ITEM_TYPES = {
      preset: { icon: '≡', label: 'Preset', valid: d => !!Lib.byId[d.base], meta: it => (Lib.byId[it.data.base] || {}).name || '?' },
      captured: { icon: '◎', label: _T('Capturé'), valid: d => Array.isArray(d.components), meta: it => plural((it.data.components || []).length, _T('effet')) + ' · ' + (it.data.frames || 0) + _T(' i') },
      ramp: { icon: '⤳', label: _T('Rampe'), valid: d => Array.isArray(d.points), meta: it => it.data.frames + _T(' i') },
      look: { icon: '◐', label: 'Look', valid: d => !!d.params && typeof d.params === 'object', open: it => app.services.openLook && app.services.openLook(it) }
    };

    /* Recherche et filtre par type, dès que la bibliothèque s'allonge. Le champ reste en place
       (pas de perte du curseur) ; seules les puces et la liste sont refaites. */
    const mineFilter = { q: '', type: 'all' };
    function renderMineFilter() {
      const box = $('mine-filter');
      if (!box) return;
      const items = S.lib.items, counts = {};
      items.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
      const types = Object.keys(counts);
      if (items.length < 6 || !types.length) { box.innerHTML = ''; mineFilter.q = ''; mineFilter.type = 'all'; return; }
      if (mineFilter.type !== 'all' && !counts[mineFilter.type]) mineFilter.type = 'all';
      let input = box.querySelector('input');
      if (!input) {
        input = h('input', { class: 'textfield', placeholder: _T('Rechercher dans ') + plural(items.length, _T('élément')), value: mineFilter.q, 'aria-label': _T('Rechercher dans la bibliothèque') });
        input.addEventListener('input', () => { mineFilter.q = input.value; renderMineItems(); });
        box.appendChild(h('div', { class: 'search-row' }, input));
        box.appendChild(h('div', { class: 'chips mine-chips' }));
      }
      input.placeholder = _T('Rechercher dans ') + plural(items.length, _T('élément'));
      const chips = box.querySelector('.mine-chips');
      chips.innerHTML = '';
      [['all', _T('Tout'), items.length]].concat(types.map(t => [t, (ITEM_TYPES[t] || { label: t }).label, counts[t]])).forEach(([v, label, n]) => {
        const b = h('button', { class: 'action' + (mineFilter.type === v ? ' selected' : '') }, label + ' ', h('span', { class: 'count' }, String(n)));
        b.addEventListener('click', () => { mineFilter.type = v; renderMineList(); });
        chips.appendChild(b);
      });
    }

    function renderMineList() {
      renderMineFilter();
      renderMineItems();
    }

    function renderMineItems() {
      const list = $('mine-list');
      if (!list) return;
      list.innerHTML = '';
      if (!S.lib.items.length) {
        list.appendChild(h('div', { class: 'note' }, _T('Rien pour l\'instant : enregistre un preset (« ＋ Preset » sur un effet), une rampe, un look, un style de texte… ou capture un clip. « Importer… » ajoute ce qu\'on t\'a envoyé.')));
        return;
      }
      const q = mineFilter.q.trim().toLowerCase();
      const shown = S.lib.items.filter(i => (mineFilter.type === 'all' || i.type === mineFilter.type) && (!q || i.name.toLowerCase().includes(q)));
      if (!shown.length) { list.appendChild(h('div', { class: 'note' }, _T('Rien ne correspond.'))); return; }
      shown.sort((a, b) => b.created - a.created).forEach(item => {
        const T = ITEM_TYPES[item.type] || { icon: '•', label: item.type }, ic = T.icon;
        let meta = T.label;
        try { if (T.meta) meta += ' · ' + T.meta(item); } catch (e) { /* détail illisible : le nom suffit */ }
        const btn = (text, title, fn, cls) => { const b = h('button', { class: 'action quiet' + (cls ? ' ' + cls : ''), title }, text); b.addEventListener('click', fn); return b; };
        const li = h('div', { class: 'list-item' },
          h('span', { class: 'li-icon' }, ic),
          h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, item.name), h('div', { class: 'li-meta' }, meta)),
          h('div', { class: 'li-actions' },
            btn(_T('Ouvrir'), _T('Ouvrir (ou double-clic)'), () => openItem(item), 'li-main'),
            btn('✎', _T('Renommer'), async () => { const n = await promptName(_T('Renommer'), item.name); if (n) { item.name = n; persist(); renderMineList(); } }),
            btn('⤓', _T('Exporter'), () => exportItems([item], item.name.replace(/[^\w\-]+/g, '_') + '.rrfx.json')),
            btn('⇪', _T('Partager (code à copier-coller)'), () => shareItems([item], item.name)),
            btn('🌐', _T('Publier dans la bibliothèque en ligne'), () => publishItems([item], item.name)),
            btn('✕', _T('Supprimer'), () => deleteItem(item), 'danger')));
        li.addEventListener('dblclick', () => openItem(item));
        list.appendChild(li);
      });
    }

    async function deleteItem(item) {
      const yes = await modal(_T('Supprimer « ') + item.name + _T(' » ?'), h('p', null, _T('C\'est définitif. Exporte-le d\'abord pour le garder.')), [
        { label: _T('Garder'), value: false }, { label: _T('Supprimer'), primary: true, value: true }]);
      if (!yes) return;
      S.lib.items = S.lib.items.filter(i => i !== item);
      S.lib.favorites = S.lib.favorites.filter(k => k !== 'u:' + item.id);
      // Gardé pour la synchro : supprimé ici, il l'est aussi sur tes autres ordinateurs.
      (S.lib.removed || (S.lib.removed = [])).push(item.id);
      if (S.cur && S.cur.key === 'u:' + item.id) { S.cur = entries()[0]; S.params = defaultParams(S.cur); }
      persist();
      renderMineList();
    }

    function openItem(item) {
      const T = ITEM_TYPES[item.type];
      if (T && T.open) { T.open(item); return; }
      if (item.type === 'ramp') {
        const R = ramp();
        R.points = clone(item.data.points);
        R.frames = item.data.frames;
        R.segments = item.data.segments;
        R.placement = item.data.placement || R.placement;
        R.preset = 'u:' + item.id;
        persist();
        switchTab('ramp');
        return;
      }
      const e = entryByKey('u:' + item.id);
      if (!e) return;
      S.cat = 'mine';
      S.cur = e;
      S.params = defaultParams(e);
      switchTab('effects');
    }

    function exportItems(items, name) {
      if (!items.length) { status.finish('warn', _T('Rien à exporter'), _T('La bibliothèque est vide.')); return; }
      try {
        const out = Store.exportJSON({ rrfx: 1, exported: new Date().toISOString(), items }, name);
        if (out) { status.finish('ok', plural(items.length, _T('élément exporté'), _T('éléments exportés')), out); log(_T('Exporté : ') + out, 'ok'); }
      } catch (e) {
        status.finish('error', _T('Export impossible'), errorMessage(e));
      }
    }

    // Ajoute à la bibliothèque les éléments valides ; renvoie leur nombre.
    function addItems(list) {
      let n = 0;
      list.forEach(it => {
        const T = it && ITEM_TYPES[it.type];
        if (!T || !it.data || typeof it.data !== 'object' || typeof it.name !== 'string') return;
        try { if (T.valid && !T.valid(it.data)) return; } catch (e) { return; }
        S.lib.items.push(Object.assign({}, it, { id: uid(), created: Date.now() }));
        n++;
      });
      persist();
      renderMineList();
      return n;
    }

    /* Fichiers choisis par l'utilisateur → [{ name, ext, path, bytes }] (boîte de dialogue de
       Premiere, ou du navigateur en mode démo). */
    function pickFiles(title, exts) {
      const paths = Store.pickFiles(title, exts);
      if (paths !== null) return Promise.resolve(paths.map(p => ({ name: Store.path.basename(p), ext: Store.path.extname(p).slice(1).toLowerCase(), path: p, bytes: new Uint8Array(Store.fs.readFileSync(p)) })));
      return new Promise(resolve => {
        const input = h('input', { type: 'file', class: 'hidden', multiple: true, accept: exts.map(e => '.' + e).join(',') });
        input.addEventListener('change', () => Promise.all(Array.from(input.files).map(f => f.arrayBuffer().then(b => ({ name: f.name, ext: (/\.([^.]+)$/.exec(f.name) || [0, ''])[1].toLowerCase(), path: null, bytes: new Uint8Array(b) })))).then(resolve, () => resolve([])));
        document.body.appendChild(input);
        input.click();
        setTimeout(() => input.remove(), 60000);
      });
    }

    /* Importeurs par type de fichier : chaque module ajoute les siens ({ exts, label, run(files) }
       → { n, what }, ou { handled } quand l'importeur a déjà affiché son propre résultat). « Importer… » de Mes effets reconnaît tout seul ce qu'on lui donne. */
    const importers = [{
      exts: ['json'], label: _T('presets RR FX (.json)'),
      run: files => {
        const items = [].concat(...files.map(f => { const j = JSON.parse(new TextDecoder().decode(f.bytes)); return Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [j]; }));
        return { n: addItems(items), what: _T('dans Mes effets') };
      }
    }];

    async function importItems() {
      const exts = Array.from(new Set([].concat(...importers.map(i => i.exts))));
      const files = await pickFiles(_T('Importer des presets, packs, LUTs, couleurs ou modèles'), exts);
      if (!files.length) return;
      const done = [], bad = [];
      let handled = false;
      for (const imp of importers) {
        const mine = files.filter(f => imp.exts.indexOf(f.ext) >= 0);
        if (!mine.length) continue;
        try {
          const r = await imp.run(mine);
          if (r && r.n) done.push(plural(r.n, _T('élément')) + ' ' + (r.what || ''));
          if (r && r.handled) handled = true;
        } catch (e) { bad.push(mine.map(f => f.name).join(', ') + ' : ' + errorMessage(e)); }
      }
      files.filter(f => !importers.some(i => i.exts.indexOf(f.ext) >= 0)).forEach(f => bad.push(f.name + _T(' : type non reconnu')));
      bad.forEach(b => log(b, 'warn'));
      renderMineList();
      if (done.length) status.finish(bad.length ? 'warn' : 'ok', _T('Importé'), done.join(' · ') + (bad.length ? ' · ' + plural(bad.length, _T('fichier')) + _T(' ignoré(s) (journal)') : ''));
      else if (!handled) status.finish('warn', _T('Rien d\'importé'), bad[0] || _T('Aucun élément valide dans ces fichiers.'));
    }

    function copyText(text, field) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => copyText(text, null));
      if (field) { field.focus(); field.select(); }
      let done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      return Promise.resolve(done);
    }

    function shareItems(items, label) {
      if (!items.length) { status.finish('warn', _T('Rien à partager'), _T('La bibliothèque est vide.')); return; }
      const code = Share.encode(items, Store.zip);
      const field = h('textarea', { class: 'code share-code', readonly: true, rows: 4, spellcheck: 'false' }, code);
      const msg = h('div', { class: 'note' }, plural(items.length, _T('élément'), _T('éléments')) + ' · ' + code.length + _T(' caractères. Envoie ce code : il se colle dans RR FX > Mes effets > « Coller un code… ».'));
      const copy = h('button', { class: 'action' }, _T('Copier'));
      copy.addEventListener('click', () => copyText(code, field).then(ok => { copy.textContent = ok ? _T('Copié ✓') : _T('Sélectionne et copie (Ctrl/Cmd+C)'); field.select(); }));
      modal(_T('Partager · ') + label, h('div', null, field, msg, h('div', { class: 'row-buttons' }, copy)), [{ label: _T('Fermer'), primary: true, value: true }]);
      setTimeout(() => { field.focus(); field.select(); }, 0);
      log(_T('Code de partage créé : ') + label + ' (' + plural(items.length, _T('élément'), _T('éléments')) + ')', 'info');
    }

    async function pasteCode() {
      const field = h('textarea', { class: 'code share-code', rows: 4, spellcheck: 'false', placeholder: 'RRFX1:…' });
      setTimeout(() => field.focus(), 0);
      const code = await modal(_T('Coller un code RR FX'), h('div', null, field, h('div', { class: 'note' }, _T('Colle ici un code reçu (il commence par « RRFX1: »).'))), [
        { label: _T('Annuler'), value: null }, { label: _T('Ajouter'), primary: true, value: () => field.value }]);
      if (!code) return;
      let items;
      try { items = Share.decode(code, Store.zip); } catch (e) { status.finish('error', _T('Code invalide'), errorMessage(e)); return; }
      const n = addItems(items);
      if (n) status.finish('ok', plural(n, _T('élément ajouté'), _T('éléments ajoutés')), items.map(i => i.name).slice(0, 4).join(', ') + (items.length > 4 ? '…' : ''));
      else status.finish('warn', _T('Rien d\'ajouté'), _T('Ce code ne contient pas d\'effet compatible avec cette version.'));
    }

    // ---------------------------------------------------------------- bibliothèque en ligne

    const decodeCode = code => Share.decode(code, Store.zip);
    const fromCommunity = e => S.lib.items.filter(i => i.from && i.from.number === e.number);

    async function loadCommunity(force) {
      const C = S.comm;
      if (C.loading) return;
      C.loading = true;
      C.error = '';
      renderCommunityList();
      try {
        const r = await Community.load({ fetch: (u, o) => fetch(u, o), storage, decode: decodeCode, force });
        if (force) commThumbs.clear();
        C.list = r.list;
        C.error = r.error || '';
        C.at = Date.now();
        if (r.error) log(_T('Bibliothèque en ligne : ') + r.error, 'warn');
      } finally {
        C.loading = false;
        renderCommunityList();
      }
    }

    function renderCommunity(view) {
      const C = S.comm;
      const search = h('input', { class: 'textfield', placeholder: _T('Rechercher (nom, auteur, style…)'), value: C.search, spellcheck: 'false' });
      search.addEventListener('input', () => { C.search = search.value; renderCommunityList(); });
      const refresh = h('button', { class: 'action quiet', title: _T('Relire la bibliothèque sur GitHub') }, '↻');
      refresh.addEventListener('click', () => loadCommunity(true));
      view.appendChild(section(_T('Bibliothèque en ligne'), [
        h('div', { class: 'note' }, _T('Les effets publiés par les utilisateurs de RR FX. « Ajouter » les range dans ta bibliothèque, comme les tiens. Pour aimer un effet : ❤ ouvre sa page, ajoute la réaction 👍.')),
        h('div', { class: 'search' }, search, refresh),
        row(_T('Trier'), actionGroup([{ v: 'popular', label: _T('Les plus aimés') }, { v: 'recent', label: _T('Les plus récents') }], C.sort, v => { C.sort = v; renderCommunityList(); })),
        row('Type', picker([{ v: 'all', label: _T('Tout') }, { v: 'preset', label: 'Presets' }, { v: 'captured', label: _T('Effets capturés') }, { v: 'ramp', label: _T('Rampes') }, { v: 'look', label: _T('Looks (couleur)') }, { v: 'textStyle', label: _T('Styles de texte') }, { v: 'titleAnim', label: _T('Animations de texte') }, { v: 'gradient', label: _T('Dégradés') }, { v: 'palette', label: 'Palettes' }, { v: 'xpStyle', label: _T('Styles Express') }, { v: 'projectTemplate', label: _T('Modèles de projet') }], C.type, v => { C.type = v; renderCommunityList(); })),
        h('div', { id: 'comm-list' })
      ]));
      view.appendChild(section(_T('Publier'), [
        h('div', { class: 'note' }, _T('Le bouton du haut (ou 🌐 sur un effet de ta bibliothèque) ouvre le formulaire de publication dans ton navigateur, déjà rempli : il reste à cliquer sur « Submit new issue » (compte GitHub gratuit). Ton effet apparaît ensuite ici pour tout le monde.'))
      ]));
      if (!C.list || Date.now() - C.at > Community.CACHE_MS) loadCommunity(false);
      else renderCommunityList();
    }

    // Petite vignette d'un preset ou d'un effet capturé partagé (dessinée une fois par effet publié).
    const commThumbs = new Map();
    function communityThumb(e) {
      if (!commThumbs.has(e.number)) commThumbs.set(e.number, drawCommunityThumb(e.items[0]));
      return h('div', { class: 'comm-thumb' }, commThumbs.get(e.number));
    }
    function drawCommunityThumb(it) {
      const cv = h('canvas', { width: 160, height: 90 });
      let entry = null;
      if (it.type === 'preset' && Lib.byId[it.data.base]) entry = { kind: 'preset', name: it.name, def: Lib.byId[it.data.base], item: it };
      if (it.type === 'captured') entry = { kind: 'captured', name: it.name, def: null, item: it };
      if (it.type === 'look' && window.RRFXDevelop) {
        // Un look : le plan de test passé dans sa LUT.
        const g = cv.getContext('2d');
        g.drawImage(Pv.shots().A, 0, 0, 160, 90);
        const d = g.getImageData(0, 0, 160, 90);
        window.RRFXAssets.applyLut(d.data, window.RRFXDevelop.buildLut(it.data.params, 9));
        g.putImageData(d, 0, 0);
        return cv;
      }
      if (entry) drawThumb(cv, entry);
      else {
        const g = cv.getContext('2d');
        g.fillStyle = '#111'; g.fillRect(0, 0, 160, 90);
        g.fillStyle = '#9ab'; g.font = '28px sans-serif'; g.textAlign = 'center'; g.fillText('⤳', 80, 56);
      }
      return cv;
    }

    function renderCommunityList() {
      const box = $('comm-list'), C = S.comm;
      if (!box) return;
      box.innerHTML = '';
      if (C.loading && !C.list) { box.appendChild(h('div', { class: 'note' }, _T('Chargement de la bibliothèque…'))); return; }
      if (C.error) box.appendChild(h('div', { class: 'note warn' }, '⚠ ' + C.error));
      const list = Community.filter(C.list || [], C);
      if (!list.length) {
        box.appendChild(h('div', { class: 'note' }, (C.list && C.list.length) ? _T('Aucun effet ne correspond.') : _T('Personne n\'a encore publié d\'effet : sois le premier !')));
        return;
      }
      list.slice(0, 120).forEach(e => {
        const mine = fromCommunity(e), date = new Date(e.created);
        const add = h('button', { class: 'action' }, mine.length ? _T('Ouvrir') : _T('Ajouter'));
        add.addEventListener('click', () => {
          if (mine.length) return openItem(mine[0]);
          const n = addItems(e.items.map(it => Object.assign({}, it, { from: { number: e.number, author: e.author } })));
          if (n) status.finish('ok', _T('Ajouté : ') + e.name, _T('Par @') + e.author + (n > 1 ? ' · ' + plural(n, _T('effet')) : '') + _T(' · dans « Mes effets ».'));
          else status.finish('warn', _T('Rien d\'ajouté'), _T('Cet effet n\'est pas compatible avec ta version de RR FX.'));
          renderCommunityList();
        });
        const like = h('button', { class: 'action quiet', title: _T('Ouvrir sa page pour l\'aimer (réaction 👍) ou commenter') }, '❤ ' + e.likes);
        like.addEventListener('click', () => Host.openURL(e.url));
        const types = e.types.map(t => Community.TYPES[t] || t).join(', ') + (e.items.length > 1 ? ' × ' + e.items.length : '');
        box.appendChild(h('div', { class: 'comm-item' },
          communityThumb(e),
          h('div', { class: 'li-text' },
            h('div', { class: 'li-name' }, e.name),
            h('div', { class: 'li-meta' }, types + ' · @' + e.author + ' · ' + date.toLocaleDateString('fr-FR')),
            e.desc ? h('div', { class: 'comm-desc' }, e.desc) : null,
            h('div', { class: 'row-buttons' }, add, like))));
      });
    }

    // Ouvre le formulaire de publication pré-rempli (le code va dans l'adresse s'il n'est pas trop long).
    async function publishItems(items, defaultName) {
      if (!items.length) { status.finish('warn', _T('Rien à publier'), _T('Ta bibliothèque est vide : enregistre un preset ou capture un effet.')); return; }
      const name = h('input', { class: 'textfield', value: defaultName || items[0].name });
      const desc = h('textarea', { class: 'code lyrics', rows: 4, placeholder: _T('Pour quel genre de montage, sur quelle musique…') });
      const ok = await modal(_T('Publier dans la bibliothèque en ligne'), h('div', null,
        row(_T('Nom'), name), desc,
        h('div', { class: 'note' }, (items.length > 1 ? plural(items.length, _T('effet')) + _T(', publiés ensemble. ') : '') + _T('Le formulaire s\'ouvre dans ton navigateur : vérifie, puis « Submit new issue ». Publié sous ton nom GitHub, visible par tous.'))), [
        { label: _T('Annuler'), value: false }, { label: _T('Ouvrir le formulaire'), primary: true, value: true }]);
      if (!ok || !name.value.trim()) return;
      const code = Share.encode(items, Store.zip);
      const p = Community.publishURL({ name: name.value.trim(), desc: desc.value.trim(), code });
      if (!p.withCode) await copyText(code, null);
      Host.openURL(p.url);
      log(_T('Publication ouverte dans le navigateur : ') + name.value.trim(), 'info');
      status.finish('ok', _T('Formulaire ouvert dans ton navigateur'), p.withCode
        ? _T('Clique sur « Submit new issue » : ton effet apparaîtra dans la bibliothèque en ligne.')
        : _T('Le code était trop long pour l\'adresse : il est copié, colle-le dans « Code RR FX », puis « Submit new issue ».'));
    }

    async function publishPicker() {
      if (!S.lib.items.length) { status.finish('warn', _T('Rien à publier'), _T('Enregistre un preset (＋ Preset), une rampe, ou capture un effet d\'abord.')); return; }
      const opts = S.lib.items.slice().sort((a, b) => b.created - a.created).map(i => ({ v: i.id, label: i.name }));
      let pick = opts[0].v;
      const ok = await modal(_T('Quel effet publier ?'), picker(opts, pick, v => { pick = v; }), [
        { label: _T('Annuler'), value: false }, { label: _T('Continuer'), primary: true, value: true }]);
      if (!ok) return;
      const item = S.lib.items.find(i => i.id === pick);
      if (item) publishItems([item], item.name);
    }

    Object.assign(core, { ITEM_TYPES, addItems, capture, importItems, importers, pickFiles, publishPicker, renderMineView });
  });
})();
