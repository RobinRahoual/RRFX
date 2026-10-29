/* RR FX : onglet Textes : titres et paroles animés, posés sur les marqueurs ou les
   temps forts, à partir d'un modèle de texte Premiere (.mogrt). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Core, Lib, Store, Host, Pv } = app;
    const { h, hotText, actionGroup, picker, row, section, Player } = app.UI;

    const DEFAULTS = { mogrt: '', style: '', text: '', split: 'lines', timing: 'markers', from: 'playhead', gap: 2, maxDur: 0, fixed: 1.5, anim: 'pop', inF: 6, outF: 5, params: {} };
    // Complète les réglages sans remplacer l'objet (l'interface garde une référence dessus).
    const st = () => {
      const s = app.settings();
      if (!s.titles || typeof s.titles !== 'object') s.titles = {};
      Object.keys(DEFAULTS).forEach(k => { if (!(k in s.titles)) s.titles[k] = k === 'params' ? {} : DEFAULTS[k]; });
      return s.titles;
    };
    const anim = () => Lib.titleById[st().anim] || Lib.titleById.pop;
    // Animations enregistrées (Mes effets) : « u:<id> ».
    const userAnims = () => app.S.lib.items.filter(i => i.type === 'titleAnim' && Lib.titleById[i.data.anim]);
    /* Animation choisie (intégrée ou enregistrée) → { a, params, inF, outF }. */
    function resolveAnim(id) {
      const t = st();
      if (id && id.indexOf('u:') === 0) {
        const it = app.S.lib.items.find(i => 'u:' + i.id === id);
        if (it && Lib.titleById[it.data.anim]) {
          const a = Lib.titleById[it.data.anim];
          return { a, params: Object.assign(Core.paramDefaults(a), it.data.params || {}), inF: it.data.inF != null ? it.data.inF : t.inF, outF: it.data.outF != null ? it.data.outF : t.outF };
        }
      }
      const a = Lib.titleById[id] || anim();
      return { a, params: Object.assign(Core.paramDefaults(a), t.params[a.id] || {}), inF: t.inF, outF: t.outF };
    }
    const animOptions = () => Lib.TITLE_ANIMS.map(a => ({ v: a.id, label: a.name })).concat(userAnims().map(i => ({ v: 'u:' + i.id, label: '★ ' + i.name })));
    const animParams = () => Object.assign(Core.paramDefaults(anim()), st().params[st().anim] || {});

    // ---------------------------------------------------------------- modèles .mogrt

    let found = null;
    function userDir() {
      if (!Store.fs) return null;
      const d = Store.path.join(Store.dir, 'Titres');
      Store.fs.mkdirSync(d, { recursive: true });
      return d;
    }
    function scanMogrts() {
      if (!Store.fs) return [{ path: 'demo.mogrt', name: _T('Titre simple (démo)') }];
      const P = Store.path, mine = userDir(), dirs = [mine];
      const appData = (root.process && root.process.env && root.process.env.APPDATA) || '';
      dirs.push(appData ? P.join(appData, 'Adobe', 'Common', 'Motion Graphics Templates')
        : P.join(Store.os.homedir(), 'Library', 'Application Support', 'Adobe', 'Common', 'Motion Graphics Templates'));
      const appPath = app.S.compat && app.S.compat.appPath;
      if (appPath) [P.join(appPath, 'Essential Graphics'), P.join(appPath, 'Contents', 'Essential Graphics'), P.join(P.dirname(appPath), 'Essential Graphics')].forEach(d => dirs.push(d));
      const seen = {}, out = [];
      dirs.forEach(d => Store.listFiles(d, /\.mogrt$/i, 300, 4).forEach(f => {
        if (seen[f]) return;
        seen[f] = true;
        out.push({ path: f, name: P.basename(f, P.extname(f)) + (f.indexOf(mine) === 0 ? '' : '  ·  ' + P.basename(P.dirname(f))) });
      }));
      out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return out;
    }
    function addMogrt() {
      const files = Store.pickFiles(_T('Choisir un modèle de texte (.mogrt)'), ['mogrt']);
      if (files === null) return app.status.finish('warn', _T('Disponible dans Premiere'), _T('Le choix de fichier passe par Premiere.'));
      const dir = userDir();
      try {
        files.forEach(f => { const to = Store.path.join(dir, Store.path.basename(f)); if (Store.path.resolve(f) !== Store.path.resolve(to)) Store.fs.copyFileSync(f, to); });
      } catch (e) {
        return app.status.finish('error', _T('Modèle non ajouté'), app.errorMessage(e));
      }
      found = null;
      if (files.length) st().mogrt = Store.path.join(dir, Store.path.basename(files[0]));
      app.persist();
      app.switchTab('titles');
    }

    // ---------------------------------------------------------------- calcul des textes

    async function timeline() {
      const t = st(), fps = app.fps();
      const chunks = Core.splitLyrics(t.text, t.split);
      if (!chunks.length) throw new Error(_T('Écris (ou colle) le texte ou les paroles.'));
      const r = await Host.call('markerList', {});
      if (!r.ok) throw new Error(r.error);
      if (t.from === 'selection' && !r.range) throw new Error(_T('Sélectionne des clips dans la timeline (ou choisis « À partir de : la tête de lecture »).'));
      const from = t.from === 'selection' ? r.range.a : t.from === 'start' ? 0 : r.playhead;
      let times = null;
      if (t.timing === 'markers') {
        times = r.markers.map(m => m.t);
        if (!times.filter(x => x >= from - 1e-6).length) throw new Error(_T('Aucun marqueur après le point de départ : pose les temps forts (onglet Musique) ou des marqueurs (touche M).'));
      } else if (t.timing === 'beats') {
        times = await app.services.beatTimes();
      }
      const items = Core.titleTimeline(chunks, times, { from, fixed: t.timing === 'fixed' ? t.fixed : 0, gap: t.gap / fps, lastDur: 2, maxDur: t.maxDur || 0 });
      if (items.length < chunks.length) app.log((chunks.length - items.length) + _T(' texte(s) sans temps disponible : ajoute des marqueurs.'), 'warn');
      return items;
    }

    /* Pose des textes minutés : items [{ start, end, text, key }] (s). opts : anim (id), pos
       [x, y] (0 à 1), label (historique), keyFx (effets en plus sur les textes key). → { created,
       track, warnings, error } */
    async function placeItems(items, opts) {
      const t = st(), o = opts || {}, fps = app.fps(), created = [], warnings = [];
      const { a, params, inF, outF } = resolveAnim(o.anim || t.anim);
      // Style de texte : celui demandé, sinon celui de l'onglet Textes ('' : celui du modèle).
      const TS = app.textStyles, style = TS ? TS.styleById('style' in o ? o.style : t.style) : null;
      const styleFx = style ? TS.styleFx(style) : null;
      let track = null;
      for (let i = 0; i < items.length; i++) {
        if (app.S.cancel) break;
        const it = items[i];
        app.status.progress(i, items.length, it.text);
        const frames = Math.max(1, Math.round((it.end - it.start) * fps));
        const fx = Core.titleSpec(a, params, frames, inF, outF, fps, app.registry());
        // Mot clé : effets en plus (couleur, taille) donnés par opts.keyFx.
        const all = it.key && o.keyFx ? fx.concat(o.keyFx) : fx;
        const r = await Host.call('placeTitle', { mogrt: t.mogrt, start: it.start, end: it.end, text: it.text, fx: all, track, spanEnd: items[items.length - 1].end, minTrack: 1, pos: o.pos || null, style, styleFx });
        if (!r.ok) {
          if (!created.length) return { created, track, warnings, error: r.error };
          warnings.push(it.text + ' : ' + r.error);
          continue;
        }
        track = r.track;
        created.push.apply(created, r.created);
        warnings.push.apply(warnings, r.warnings);
      }
      if (created.length) app.pushHistory({ date: Date.now(), label: (o.label || _T('Textes')) + ' × ' + created.length, entries: created });
      Array.from(new Set(warnings)).forEach(w => app.log(w, 'warn'));
      return { created, track, warnings, anim: a };
    }

    function place() {
      const t = st();
      return app.runTask(_T('Textes'), async () => {
        if (!t.mogrt) return { kind: 'error', title: _T('Choisis un modèle de texte'), detail: _T('Section « Modèle de texte » : un .mogrt (Premiere en fournit, ou exporte le tien).') };
        app.status.phase(_T('Calcul des temps'));
        const items = await timeline();
        if (!items.length) return { kind: 'warn', title: _T('Aucun texte posé'), detail: _T('Pas de temps disponible.') };
        app.status.phase(_T('Pose des textes'));
        const r = await placeItems(items, {});
        if (r.error) return { kind: 'error', title: _T('Textes non posés'), detail: r.error };
        return { kind: r.warnings.length ? 'warn' : 'ok', title: app.plural(r.created.length, _T('texte posé'), _T('textes posés')) + (r.track !== null ? _T(' sur V') + (r.track + 1) : ''), detail: _T('Animation « ') + r.anim.name + _T(' » · modifiables dans Options d\'effet et Objets graphiques essentiels.') };
      }, true);
    }

    // ---------------------------------------------------------------- aperçu

    function keysToValues(keys, N) {
      const out = [];
      for (let i = 0; i < N; i++) {
        let a = keys[0], b = keys[keys.length - 1];
        for (const k of keys) { if (k[0] <= i) a = k; if (k[0] >= i) { b = k; break; } }
        if (a[0] === b[0] || !Array.isArray(a[1]) && typeof a[1] !== 'number') { out.push(a[1]); continue; }
        const u = (i - a[0]) / (b[0] - a[0]);
        out.push(Array.isArray(a[1]) ? a[1].map((v, j) => v + (b[1][j] - v) * u) : a[1] + (b[1] - a[1]) * u);
      }
      return out;
    }

    let player = null;
    function preview(canvas) {
      const g = canvas.getContext('2d'), N = 40, t = st();
      // Le premier texte, relu quand il change (l'aperçu suit la saisie).
      let lastText = null, sample = '';
      const sampleText = () => {
        if (t.text !== lastText) { lastText = t.text; sample = Core.splitLyrics(t.text, t.split)[0] || _T('Tes paroles ici'); }
        return sample;
      };
      let spec = [];
      const build = () => {
        spec = Core.titleSpec(anim(), animParams(), N, t.inF, t.outF, 25).map(fx => Object.assign({}, fx, { props: fx.props.map(p => (p.keys ? Object.assign({}, p, { values: keysToValues(p.keys, N) }) : p)) }));
      };
      build();
      if (player) player.stop();
      player = Player({
        length: () => N + 10,
        fps: () => 25,
        draw: n => {
          Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
          if (n >= N) return;
          const s = Pv.stateAt(spec, n), W = canvas.width, H = canvas.height;
          g.save();
          g.globalAlpha = Math.max(0, Math.min(1, s.opacity));
          g.translate(W / 2 + s.px * W, H * 0.72 + s.py * H);
          g.rotate(s.rot * Math.PI / 180);
          g.scale(s.scale, s.scale);
          if (s.blur > 0.3 || s.dlen > 1) g.filter = 'blur(' + ((s.blur + s.dlen * 0.3) * 0.12 * W / Pv.W).toFixed(2) + 'px)';
          const txt = sampleText(), TS = app.textStyles, sty = TS && TS.styleById(t.style);
          // Avec le style choisi (section Style du texte) ; sinon un texte blanc lisible.
          if (sty) TS.paint(g, txt, sty, 0, 0, H * 0.11);
          else {
            g.font = '800 ' + Math.round(H * 0.11) + 'px ' + app.UI.css('--font');
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.lineWidth = H * 0.012;
            g.strokeStyle = 'rgba(0,0,0,0.55)';
            g.strokeText(txt, 0, 0);
            g.fillStyle = '#fff';
            g.fillText(txt, 0, 0);
          }
          g.restore();
        }
      });
      player.rebuild = build;
    }

    // ---------------------------------------------------------------- interface

    function render(view) {
      const t = st();
      view.innerHTML = '';
      if (!found) found = scanMogrts();
      if (!t.mogrt && found.length) t.mogrt = found[0].path;

      const add = h('button', { class: 'action' }, _T('Ajouter un .mogrt…'));
      add.addEventListener('click', addMogrt);
      const rescan = h('button', { class: 'action quiet' }, _T('Rafraîchir'));
      rescan.addEventListener('click', () => { found = null; render(view); });
      const opts = found.map(f => ({ v: f.path, label: f.name }));
      if (t.mogrt && !opts.some(o => o.v === t.mogrt)) opts.unshift({ v: t.mogrt, label: Store.path ? Store.path.basename(t.mogrt) : t.mogrt });
      view.appendChild(section(_T('Modèle de texte'), [
        opts.length ? row(_T('Modèle'), picker(opts, t.mogrt, v => { t.mogrt = v; app.persist(); })) : h('div', { class: 'note' }, _T('Aucun modèle trouvé.')),
        h('div', { class: 'row-buttons' }, add, rescan),
        h('div', { class: 'note' }, _T('Pour utiliser ta police et ton style : crée un texte dans Premiere (outil Texte), règle-le dans « Objets graphiques essentiels », puis clic droit sur le clip > Exporter comme modèle d\'animations graphiques, et ajoute le fichier ici.'))
      ]));

      const ta = h('textarea', { class: 'code lyrics', rows: 6, spellcheck: 'true', placeholder: _T('Une ligne par texte (ou un mot par marqueur)…') }, t.text);
      const count = h('div', { class: 'note' });
      const updateCount = () => { count.textContent = app.plural(Core.splitLyrics(t.text, t.split).length, _T('texte')) + _T(' à poser.'); };
      ta.addEventListener('input', () => { t.text = ta.value; updateCount(); app.persist(); });
      updateCount();
      view.appendChild(section(_T('Texte et paroles'), [
        ta,
        row(_T('Découpage'), actionGroup([{ v: 'lines', label: _T('Une ligne par texte') }, { v: 'words', label: _T('Un mot par texte') }], t.split, v => { t.split = v; updateCount(); app.persist(); })),
        count
      ]));

      const fixedRow = row(_T('Durée de chaque texte'), hotText({ value: t.fixed, min: 0.2, max: 20, step: 0.1, unit: 's', onChange: v => { t.fixed = v; app.persist(); } }));
      const timingPick = picker([
        { v: 'markers', label: _T('Marqueurs de la séquence') },
        { v: 'beats', label: _T('Temps forts détectés') },
        { v: 'fixed', label: _T('Durée fixe') }
      ], t.timing, v => { t.timing = v; fixedRow.classList.toggle('hidden', v !== 'fixed'); app.persist(); });
      fixedRow.classList.toggle('hidden', t.timing !== 'fixed');
      view.appendChild(section('Placement', [
        row(_T('Un texte par'), timingPick),
        fixedRow,
        row(_T('À partir de'), picker([{ v: 'playhead', label: _T('La tête de lecture') }, { v: 'selection', label: _T('Début des clips sélectionnés') }, { v: 'start', label: _T('Début de la séquence') }], t.from, v => { t.from = v; app.persist(); })),
        row(_T('Écart minimum'), hotText({ value: t.gap, min: 0, max: 50, step: 1, unit: 'i', onChange: v => { t.gap = v; app.persist(); } })),
        row(_T('Durée max.'), hotText({ value: t.maxDur, min: 0, max: 30, step: 0.5, unit: 's', onChange: v => { t.maxDur = v; app.persist(); } }), { title: _T('0 = jusqu\'au temps suivant') }),
        h('div', { class: 'note' }, _T('Écart : images laissées libres entre deux textes. Durée max. : 0 = chaque texte reste jusqu\'au suivant.'))
      ]));

      const cv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
      const params = h('div');
      const renderParams = () => {
        params.innerHTML = '';
        const p = animParams(), a = anim();
        (a.params || []).forEach(q => {
          const save = v => { st().params[st().anim] = Object.assign({}, st().params[st().anim], { [q.key]: v }); app.persist(); if (player) player.rebuild(); };
          if (q.type === 'range') params.appendChild(row(q.label, hotText({ value: p[q.key], min: q.min, max: q.max, step: q.step, unit: q.unit, onChange: (v, fin) => { if (fin) save(v); } })));
          else params.appendChild(row(q.label, actionGroup(q.options, p[q.key], save)));
        });
      };
      renderParams();
      const rebuild = () => { app.persist(); if (player) player.rebuild(); };
      // Une animation enregistrée se charge dans les réglages (modifiable, ré-enregistrable).
      const pickAnim = v => {
        if (v.indexOf('u:') === 0) {
          const it = app.S.lib.items.find(i => 'u:' + i.id === v);
          if (it) { t.anim = it.data.anim; t.params[it.data.anim] = Object.assign({}, it.data.params); if (it.data.inF != null) t.inF = it.data.inF; if (it.data.outF != null) t.outF = it.data.outF; }
          app.persist();
          return render(view);
        }
        t.anim = v; renderParams(); rebuild();
      };
      const saveAnim = h('button', { class: 'action' }, _T('Enregistrer l\'animation…'));
      saveAnim.addEventListener('click', async () => {
        const name = await app.promptName(_T('Nom de l\'animation'), anim().name + _T(' perso'));
        if (!name) return;
        app.services.addItems([{ type: 'titleAnim', name, data: { anim: t.anim, params: Object.assign({}, animParams()), inF: t.inF, outF: t.outF } }]);
        app.status.finish('ok', _T('Animation « ') + name + _T(' » enregistrée'), _T('Dans la liste des animations (★), dans Mes effets, et pour les sous-titres et bandeaux.'));
        render(view);
      });
      if (app.textStyles) view.appendChild(app.textStyles.section(t, 'style', _T('Style du texte'), Core.splitLyrics(t.text, t.split)[0], { preview: false }));
      view.appendChild(section('Animation', [
        row('Style', picker(animOptions(), t.anim, pickAnim)),
        row(_T('Entrée'), hotText({ value: t.inF, min: 0, max: 60, step: 1, unit: 'i', onChange: (v, fin) => { t.inF = v; if (fin) rebuild(); } })),
        row(_T('Sortie'), hotText({ value: t.outF, min: 0, max: 60, step: 1, unit: 'i', onChange: (v, fin) => { t.outF = v; if (fin) rebuild(); } })),
        params,
        h('div', { class: 'preview' }, h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, _T('Aperçu : animation et style')))),
        h('div', { class: 'row-buttons' }, saveAnim)
      ]));
      preview(cv);
      if (app.textStyles) view.appendChild(app.textStyles.colorsSection(() => render(view)));
      app.renderExtras('titles', view);
    }

    app.actions.titles = place;
    app.services.lyrics = () => String(st().text || '').trim();
    app.services.placeTexts = placeItems;
    app.services.titleAnimOptions = animOptions;
    app.itemTypes.titleAnim = {
      icon: 'T', label: _T('Animation de texte'), valid: d => !!Lib.titleById[d.anim],
      meta: it => Lib.titleById[it.data.anim].name + _T(' · entrée ') + (it.data.inF || 0) + _T(' i'),
      open: it => { const t = st(); t.anim = it.data.anim; t.params[it.data.anim] = Object.assign({}, it.data.params); if (it.data.inF != null) t.inF = it.data.inF; if (it.data.outF != null) t.outF = it.data.outF; app.persist(); app.switchTab('titles'); }
    };
    // Un modèle de texte importé depuis Mes effets > Importer… rejoint la liste des modèles.
    app.importers.push({
      exts: ['mogrt'], label: _T('modèles de texte'),
      run: files => {
        const dir = userDir();
        if (!dir) throw new Error(_T('Disponible dans Premiere.'));
        files.forEach(f => Store.fs.writeFileSync(Store.path.join(dir, f.name), Buffer.from(f.bytes)));
        found = null;
        st().mogrt = Store.path.join(dir, files[files.length - 1].name);
        app.persist();
        return { n: files.length, what: _T('dans les modèles de texte (onglet Textes)') };
      }
    });
    app.services.mogrt = () => st().mogrt || (found || (found = scanMogrts()))[0] && found[0].path || '';
    app.services.mogrtName = () => { const m = app.services.mogrt(); return m ? (Store.path ? Store.path.basename(m, Store.path.extname(m)) : m) : ''; };
    app.tabs.titles = { render, cta: () => ({ label: _T('Poser les textes'), run: place, enabled: true }), leave: () => { if (player) { player.stop(); player = null; } } };
  });
})(typeof self !== 'undefined' ? self : this);
