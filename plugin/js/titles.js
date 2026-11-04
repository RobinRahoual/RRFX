/* RR FX : onglet Textes : titres et paroles animés, posés sur les marqueurs ou les
   temps forts, à partir d'un modèle de texte Premiere (.mogrt). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Core, Lib, Store, Host, Pv } = app;
    const { h, hotText, actionGroup, picker, row, section, Player, checkbox } = app.UI;

    const DEFAULTS = { mogrt: '', style: '', text: '', animFrom: '', applyAnim: true, applyStyle: true, split: 'lines', timing: 'markers', from: 'playhead', gap: 2, maxDur: 0, fixed: 1.5, anim: 'pop', inF: 6, outF: 5, params: {} };
    // Complète les réglages sans remplacer l'objet (l'interface garde une référence dessus).
    const st = () => {
      const s = app.settings();
      if (!s.titles || typeof s.titles !== 'object') s.titles = {};
      Object.keys(DEFAULTS).forEach(k => { if (!(k in s.titles)) s.titles[k] = k === 'params' ? {} : DEFAULTS[k]; });
      // 2.16.0 rangeait l'animation chargée dans « from » (point de départ des paroles) : remis.
      if (['playhead', 'selection', 'start'].indexOf(s.titles.from) < 0) s.titles.from = 'playhead';
      return s.titles;
    };
    const anim = () => Lib.titleById[st().anim] || Lib.titleById.pop;
    // Animations enregistrées (Mes effets) : « u:<id> ».
    // Une animation capturée sur un texte de la timeline (data.captured) est rejouée telle quelle.
    const isCaptured = d => !!(d && d.captured && (d.captured.in || d.captured.out));
    const userAnims = () => app.S.lib.items.filter(i => i.type === 'titleAnim' && (Lib.titleById[i.data.anim] || isCaptured(i.data)));
    const capturedOf = id => { const it = id && id.indexOf('u:') === 0 ? app.S.lib.items.find(i => 'u:' + i.id === id) : null; return it && isCaptured(it.data) ? it.data.captured : null; };
    /* Animation choisie (intégrée ou enregistrée) → { a, params, inF, outF }. */
    function resolveAnim(id) {
      const t = st();
      const cap = capturedOf(id);
      if (cap) return { captured: cap, a: anim(), params: {}, inF: 0, outF: 0 };
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
    // Intégrées masquées (« Gérer… ») : hors de la liste, sauf celle qui est choisie.
    const builtinAnims = keep => (app.manage ? app.manage.visible('titleAnim', Lib.TITLE_ANIMS, a => a.id, keep) : Lib.TITLE_ANIMS);
    const animOptions = () => builtinAnims(st().anim).map(a => ({ v: a.id, label: a.name })).concat(userAnims().map(i => ({ v: 'u:' + i.id, label: '★ ' + i.name })));
    // Animation enregistrée chargée dans l'éditeur (« u:<id> ») : « Mettre à jour » la réécrit.
    const loadedAnim = () => { const t = st(), it = t.animFrom && app.S.lib.items.find(i => 'u:' + i.id === t.animFrom); return it && !isCaptured(it.data) && it.data.anim === t.anim ? it : null; };
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
      const { a, params, inF, outF, captured } = resolveAnim(o.anim || t.anim);
      // Style de texte : celui demandé, sinon celui de l'onglet Textes ('' : celui du modèle).
      const TS = app.textStyles, sid = 'style' in o ? o.style : t.style, style = TS ? TS.styleById(sid) : null;
      const styleFx = style ? TS.styleFx(style) : null;
      // Style capturé dans la timeline : ses réglages et ses effets, tels quels.
      const look = TS && TS.lookById ? TS.lookById(sid) : null, lookFx = look ? TS.lookFx(look) : null;
      let track = null;
      for (let i = 0; i < items.length; i++) {
        if (app.S.cancel) break;
        const it = items[i];
        app.status.progress(i, items.length, it.text);
        const frames = Math.max(1, Math.round((it.end - it.start) * fps));
        const fx = captured ? Core.titleSpecCaptured(captured, frames, app.registry()) : Core.titleSpec(a, params, frames, inF, outF, fps, app.registry());
        // Mot clé : effets en plus (couleur, taille) donnés par opts.keyFx.
        const all = it.key && o.keyFx ? fx.concat(o.keyFx) : fx;
        const r = await Host.call('placeTitle', { mogrt: t.mogrt, start: it.start, end: it.end, text: it.text, fx: all, track, spanEnd: items[items.length - 1].end, minTrack: 1, pos: o.pos || null, style, styleFx, look, lookFx });
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

    // ---------------------------------------------------------------- textes de la timeline

    // Nombre d'éléments sélectionnés dans la timeline (relu toutes les 2 s par le panneau).
    let selNote = null;
    function drawSel() {
      if (!selNote) return;
      const n = app.S.ctx && app.S.ctx.selection;
      selNote.textContent = n ? '✓ ' + app.plural(n, _T('élément sélectionné'), _T('éléments sélectionnés')) + _T(' dans la timeline.') : _T('Aucun texte sélectionné dans la timeline pour l\'instant.');
      selNote.classList.toggle('ok', !!n);
    }
    app.contextListeners.push(() => { if (selNote && selNote.isConnected) drawSel(); });

    /* Effets que posent les animations de texte (Transformer, flous…) : sur un texte qui en a
       déjà d'animés, ils sont retirés avant d'en poser une autre (pas d'empilement). */
    function animMatchNames() {
      const out = new Set();
      Lib.TITLE_ANIMS.forEach(a => { try { Core.titleSpec(a, Core.paramDefaults(a), 40, 8, 8, 25, app.registry()).forEach(f => { if (!f.intrinsic) out.add(f.matchName); }); } catch (e) { /* animation vide */ } });
      app.S.lib.items.forEach(i => {
        const c = i.type === 'titleAnim' && isCaptured(i.data) ? i.data.captured : null;
        if (c) [c.in, c.out].forEach(part => (part && part.components || []).forEach(x => { if (!x.intrinsic) out.add(x.matchName); }));
      });
      return Array.from(out);
    }

    /* L'animation et le style choisis, sur les textes sélectionnés dans la timeline : chaque
       texte garde sa place et sa durée (entrée au début, sortie à la fin). */
    function applySelection() {
      const t = st();
      return app.runTask(_T('Textes sélectionnés'), async () => {
        const sel = await Host.call('selectedTexts', {});
        if (!sel.ok) return { kind: 'warn', title: _T('Aucun texte sélectionné'), detail: sel.error };
        const TS = app.textStyles, sid = t.style;
        const R = resolveAnim(t.anim);
        const doAnim = t.applyAnim !== false && (R.captured || (R.a && R.a.id !== 'none'));
        const doStyle = t.applyStyle !== false && !!sid && !!TS;
        if (!doAnim && !doStyle) return { kind: 'warn', title: _T('Rien à appliquer'), detail: _T('Choisis une animation (autre que « Aucune ») ou un style, et coche ce qu\'il faut appliquer.') };
        const done = [], warnings = [];
        if (doAnim) {
          app.status.phase(_T('Animation'));
          const items = sel.items.map(x => ({ track: x.track, start: x.start, fx: R.captured ? Core.titleSpecCaptured(R.captured, x.frames, app.registry()) : Core.titleSpec(R.a, R.params, x.frames, R.inF, R.outF, sel.fps, app.registry()) }));
          const r = await Host.call('animateTexts', { items, replace: animMatchNames() });
          if (r.ok) {
            done.push(app.plural(r.done, _T('texte animé'), _T('textes animés')));
            if (r.created && r.created.length) app.pushHistory({ date: Date.now(), label: _T('Animation de texte'), entries: r.created });
          } else warnings.push(_T('Animation : ') + r.error);
          (r.warnings || []).forEach(w => { if (!r.ok && w === r.error) return; warnings.push(w); });
        }
        if (doStyle) {
          app.status.phase('Style');
          const look = TS.lookById(sid), sty = TS.styleById(sid);
          const r = await Host.call('applyTextLook', look ? { look, fx: TS.lookFx(look) } : { style: sty, styleFx: TS.styleFx(sty) });
          if (r.ok) done.push(app.plural(r.done, _T('texte stylé'), _T('textes stylés')));
          else warnings.push(_T('Style : ') + r.error);
          (r.warnings || []).forEach(w => warnings.push(w));
        }
        warnings.forEach(w => app.log(w, 'warn'));
        const more = warnings.length > 2 ? ' (+' + (warnings.length - 2) + _T(' dans le journal)') : '';
        if (!done.length) return { kind: 'error', title: _T('Rien n\'a été appliqué'), detail: warnings.slice(0, 2).join(' · ') + more + _T(' · « Analyser le texte sélectionné » montre ce que Premiere laisse modifier.') };
        const kinds = Array.from(new Set(sel.items.map(x => x.kind)));
        const hint = kinds.indexOf('clip') >= 0 ? _T(' Certains éléments ne sont pas des textes : seule l\'animation s\'y applique.') : '';
        return { kind: warnings.length ? 'warn' : 'ok', title: done.join(' · '), detail: (warnings.length ? warnings.slice(0, 2).join(' · ') + more : _T('Ctrl+Z dans Premiere pour revenir.')) + hint };
      });
    }

    // Rapport : ce que Premiere montre aux scripts du texte sélectionné (à copier et envoyer).
    function inspect() {
      return app.runTask(_T('Analyse du texte'), async () => {
        const r = await Host.call('inspectText', {});
        if (!r.ok) return { kind: 'warn', title: _T('Rien à analyser'), detail: r.error };
        const KIND = { mgt: _T('modèle .mogrt (réglages exposés)'), graphic: _T('texte de l\'outil Texte de Premiere'), clip: _T('pas un texte (image, vidéo…)') };
        const lines = ['RR FX ' + (Host.VERSION || '') + ' · Premiere ' + r.app, _T('Clip : ') + r.name + ' (V' + (r.track + 1) + ') · ' + (KIND[r.kind] || r.kind), ''];
        const dump = (title, c) => {
          lines.push('[' + title + '] ' + c.displayName + ' · ' + c.matchName);
          c.props.forEach(p => lines.push('  - ' + p.name + ' (' + p.type + (p.keyed ? ', ' + _T('animé') : '') + ') : ' + p.value));
        };
        if (r.mgt) dump('MGT', r.mgt);
        r.components.forEach(c => dump(_T('Composant'), c));
        const text = lines.join('\n');
        const field = h('textarea', { class: 'code', rows: 14, readonly: true, spellcheck: 'false' }, text);
        const copy = h('button', { class: 'action' }, _T('Copier le rapport'));
        copy.addEventListener('click', () => app.copyText(text).then(ok => { copy.textContent = ok ? _T('Copié ✓') : _T('Sélectionne et copie (Ctrl/Cmd+C)'); field.select(); }));
        const verdict = r.kind === 'mgt' ? _T('Police, taille, couleurs : modifiables si le modèle les expose (voir les réglages ci-dessous).')
          : r.kind === 'graphic' ? _T('Texte de l\'outil Texte : les animations marchent ; police et couleurs ne sont pas toutes accessibles aux scripts. La couleur passe par l\'effet Teinte, l\'ombre par Ombre portée.')
            : _T('Ce clip n\'est pas un texte : seules les animations s\'y appliquent.');
        app.modal(_T('Texte sélectionné'), h('div', null, h('div', { class: 'note' }, verdict), field, h('div', { class: 'row-buttons' }, copy), h('div', { class: 'note' }, _T('Si un style ou une animation ne passe pas, copie ce rapport et envoie-le à @robin.rahoual.'))), [{ label: _T('Fermer'), primary: true, value: true }]);
        return { kind: 'ok', title: _T('Analyse prête'), detail: KIND[r.kind] || r.kind };
      });
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
        const cap = capturedOf(t.anim);
        spec = (cap ? Core.titleSpecCaptured(cap, N, app.registry()) : Core.titleSpec(anim(), animParams(), N, t.inF, t.outF, 25)).map(fx => Object.assign({}, fx, { props: fx.props.map(p => (p.keys ? Object.assign({}, p, { values: keysToValues(p.keys, N) }) : p)) }));
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

      const cv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
      const params = h('div');
      const renderParams = () => {
        params.innerHTML = '';
        const cap = capturedOf(t.anim);
        if (cap) {
          params.appendChild(h('div', { class: 'note' }, _T('Animation capturée dans la timeline : rejouée telle quelle sur chaque texte') + ' (' + _T('entrée ') + (cap.in ? cap.in.frames : 0) + _T(' i, sortie ') + (cap.out ? cap.out.frames : 0) + ' i).'));
          return;
        }
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
        t.animFrom = '';
        if (capturedOf(v)) { t.anim = v; app.persist(); return render(view); }
        if (v.indexOf('u:') === 0) {
          const it = app.S.lib.items.find(i => 'u:' + i.id === v);
          if (it) { t.anim = it.data.anim; t.animFrom = v; t.params[it.data.anim] = Object.assign({}, it.data.params); if (it.data.inF != null) t.inF = it.data.inF; if (it.data.outF != null) t.outF = it.data.outF; }
          app.persist();
          return render(view);
        }
        t.anim = v; app.persist(); render(view);
      };
      const loaded = loadedAnim();
      const updateAnim = loaded ? h('button', { class: 'action', title: _T('Réécrire l\'animation enregistrée avec ces réglages') }, _T('Mettre à jour « ') + loaded.name + ' »') : null;
      if (updateAnim) updateAnim.addEventListener('click', () => {
        loaded.data = { anim: t.anim, params: Object.assign({}, animParams()), inF: t.inF, outF: t.outF };
        app.persist();
        app.status.finish('ok', _T('Animation « ') + loaded.name + _T(' » mise à jour'), _T('Partout où elle sert : textes, sous-titres, bandeaux.'));
      });
      const manageAnims = () => ({
        title: _T('Gérer les animations de texte'), kind: 'titleAnim', itemType: 'titleAnim', prefix: '',
        builtins: Lib.TITLE_ANIMS.map(a => ({ id: a.id, name: a.name })), use: pickAnim, after: () => render(view)
      });
      // Capturer : l'animation d'un texte déjà monté dans la timeline (ses images clés, ses effets).
      const grab = h('button', { class: 'action', title: _T('Sélectionne dans la timeline un texte que tu as animé toi-même') }, _T('Capturer depuis la timeline'));
      grab.addEventListener('click', () => app.runTask(_T('Capture de l\'animation'), async () => {
        const r = await Host.call('captureTitle', {});
        if (!r.ok) return { kind: 'warn', title: _T('Rien à capturer'), detail: r.error };
        const name = await app.promptName(_T('Nom de l\'animation'), String(r.name || _T('Mon animation')).replace(/\.[a-z0-9]+$/i, ''));
        if (!name) return { kind: 'idle', title: _T('Prêt') };
        app.services.addItems([{ type: 'titleAnim', name, data: { captured: r } }]);
        const it = app.S.lib.items.filter(i => i.type === 'titleAnim' && i.name === name).pop();
        if (it) { t.anim = 'u:' + it.id; app.persist(); }
        render(view);
        return { kind: 'ok', title: _T('Animation « ') + name + _T(' » capturée'), detail: _T('Entrée ') + (r.in ? r.in.frames : 0) + _T(' i, sortie ') + (r.out ? r.out.frames : 0) + _T(' i. Dans la liste des animations (★), pour tous tes textes, sous-titres et bandeaux.') };
      }));
      const saveAnim = h('button', { class: 'action' }, _T('Enregistrer l\'animation…'));
      saveAnim.addEventListener('click', async () => {
        const name = await app.promptName(_T('Nom de l\'animation'), anim().name + _T(' perso'));
        if (!name) return;
        app.services.addItems([{ type: 'titleAnim', name, data: { anim: t.anim, params: Object.assign({}, animParams()), inF: t.inF, outF: t.outF } }]);
        app.status.finish('ok', _T('Animation « ') + name + _T(' » enregistrée'), _T('Dans la liste des animations (★), dans Mes effets, et pour les sous-titres et bandeaux.'));
        render(view);
      });
      const add = h('button', { class: 'action' }, _T('Ajouter un .mogrt…'));
      add.addEventListener('click', addMogrt);
      const rescan = h('button', { class: 'action quiet' }, _T('Rafraîchir'));
      rescan.addEventListener('click', () => { found = null; render(view); });
      const opts = found.map(f => ({ v: f.path, label: f.name }));
      if (t.mogrt && !opts.some(o => o.v === t.mogrt)) opts.unshift({ v: t.mogrt, label: Store.path ? Store.path.basename(t.mogrt) : t.mogrt });
      const lyricsBody = [
        h('div', { class: 'note' }, _T('Crée de nouveaux textes à partir de paroles : un par marqueur, temps fort ou durée fixe, avec l\'animation et le style choisis ci-dessus.')),
        opts.length ? row(_T('Modèle'), picker(opts, t.mogrt, v => { t.mogrt = v; app.persist(); })) : h('div', { class: 'note' }, _T('Aucun modèle trouvé.')),
        h('div', { class: 'row-buttons' }, add, rescan),
        h('div', { class: 'note' }, _T('Pour utiliser ta police et ton style : crée un texte dans Premiere (outil Texte), règle-le dans « Objets graphiques essentiels », puis clic droit sur le clip > Exporter comme modèle d\'animations graphiques, et ajoute le fichier ici.'))
      ];

      const ta = h('textarea', { class: 'code lyrics', rows: 6, spellcheck: 'true', placeholder: _T('Une ligne par texte (ou un mot par marqueur)…') }, t.text);
      const count = h('div', { class: 'note' });
      const updateCount = () => { count.textContent = app.plural(Core.splitLyrics(t.text, t.split).length, _T('texte')) + _T(' à poser.'); };
      ta.addEventListener('input', () => { t.text = ta.value; updateCount(); app.persist(); });
      updateCount();
      lyricsBody.push(
        ta,
        row(_T('Découpage'), actionGroup([{ v: 'lines', label: _T('Une ligne par texte') }, { v: 'words', label: _T('Un mot par texte') }], t.split, v => { t.split = v; updateCount(); app.persist(); })),
        count);

      const fixedRow = row(_T('Durée de chaque texte'), hotText({ value: t.fixed, min: 0.2, max: 20, step: 0.1, unit: 's', onChange: v => { t.fixed = v; app.persist(); } }));
      const timingPick = picker([
        { v: 'markers', label: _T('Marqueurs de la séquence') },
        { v: 'beats', label: _T('Temps forts détectés') },
        { v: 'fixed', label: _T('Durée fixe') }
      ], t.timing, v => { t.timing = v; fixedRow.classList.toggle('hidden', v !== 'fixed'); app.persist(); });
      fixedRow.classList.toggle('hidden', t.timing !== 'fixed');
      lyricsBody.push(
        row(_T('Un texte par'), timingPick),
        fixedRow,
        row(_T('À partir de'), picker([{ v: 'playhead', label: _T('La tête de lecture') }, { v: 'selection', label: _T('Début des clips sélectionnés') }, { v: 'start', label: _T('Début de la séquence') }], t.from, v => { t.from = v; app.persist(); })),
        row(_T('Écart minimum'), hotText({ value: t.gap, min: 0, max: 50, step: 1, unit: 'i', onChange: v => { t.gap = v; app.persist(); } })),
        row(_T('Durée max.'), hotText({ value: t.maxDur, min: 0, max: 30, step: 0.5, unit: 's', onChange: v => { t.maxDur = v; app.persist(); } }), { title: _T('0 = jusqu\'au temps suivant') }),
        h('div', { class: 'note' }, _T('Écart : images laissées libres entre deux textes. Durée max. : 0 = chaque texte reste jusqu\'au suivant.')));
      const placeBtn = h('button', { class: 'action go' }, _T('Poser les textes'));
      placeBtn.addEventListener('click', place);
      lyricsBody.push(h('div', { class: 'row-buttons' }, placeBtn));

      // Textes de la timeline : tout se règle sur les textes sélectionnés, là où ils sont.
      grab.classList.add('grab-anim');
      const go = h('button', { class: 'action go text-apply' }, _T('Appliquer aux textes sélectionnés'));
      go.addEventListener('click', applySelection);
      const inspectBtn = h('button', { class: 'action quiet', title: _T('Ce que Premiere laisse modifier sur le texte sélectionné (rapport à copier)') }, _T('Analyser le texte sélectionné'));
      inspectBtn.addEventListener('click', inspect);
      selNote = h('div', { class: 'note text-sel' });
      drawSel();
      view.appendChild(section(_T('Textes de la timeline'), [
        h('div', { class: 'note' }, _T('Sélectionne des textes dans la timeline (outil Texte, modèles .mogrt, sous-titres…), choisis une animation et un style, puis « Appliquer » : ils sont animés et stylés sur place, quelle que soit leur durée.')),
        selNote,
        h('div', { class: 'sub-head' }, 'Animation'),
        row('Animation', app.manage ? app.manage.withManage(picker(animOptions(), loaded ? t.animFrom : t.anim, pickAnim), manageAnims) : picker(animOptions(), t.anim, pickAnim)),
        capturedOf(t.anim) ? null : row(_T('Entrée'), hotText({ value: t.inF, min: 0, max: 60, step: 1, unit: 'i', onChange: (v, fin) => { t.inF = v; if (fin) rebuild(); } })),
        capturedOf(t.anim) ? null : row(_T('Sortie'), hotText({ value: t.outF, min: 0, max: 60, step: 1, unit: 'i', onChange: (v, fin) => { t.outF = v; if (fin) rebuild(); } })),
        params,
        h('div', { class: 'row-buttons' }, grab, capturedOf(t.anim) ? null : saveAnim),
        updateAnim ? h('div', { class: 'row-buttons' }, updateAnim) : null,
        app.textStyles ? h('div', { class: 'sub-head' }, _T('Style')) : null,
        app.textStyles ? app.textStyles.section(t, 'style', _T('Style du texte'), Core.splitLyrics(t.text, t.split)[0], { preview: false, inline: true }) : null,
        h('div', { class: 'preview' }, h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, _T('Aperçu : animation et style')))),
        h('div', { class: 'row-buttons wrap' },
          checkbox(_T('Appliquer l\'animation'), t.applyAnim !== false, v => { t.applyAnim = v; app.persist(); }),
          checkbox(_T('Appliquer le style'), t.applyStyle !== false, v => { t.applyStyle = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, go),
        h('div', { class: 'row-buttons' }, inspectBtn)
      ]));
      view.appendChild(section(_T('Créer des textes (paroles)'), lyricsBody, null, true));
      preview(cv);
      if (app.textStyles) view.appendChild(app.textStyles.colorsSection(() => render(view)));
      app.renderExtras('titles', view);
    }

    app.actions.titles = place;
    app.actions.titlesSelection = applySelection;
    app.services.lyrics = () => String(st().text || '').trim();
    app.services.placeTexts = placeItems;
    app.services.titleAnimOptions = animOptions;
    app.itemTypes.titleAnim = {
      icon: 'T', label: _T('Animation de texte'), valid: d => !!Lib.titleById[d.anim] || isCaptured(d),
      meta: it => (isCaptured(it.data) ? _T('Capturée dans la timeline') : Lib.titleById[it.data.anim].name + _T(' · entrée ') + (it.data.inF || 0) + _T(' i')),
      open: it => { const t = st(); t.animFrom = ''; if (isCaptured(it.data)) { t.anim = 'u:' + it.id; app.persist(); app.switchTab('titles'); return; } t.anim = it.data.anim; t.animFrom = 'u:' + it.id; t.params[it.data.anim] = Object.assign({}, it.data.params); if (it.data.inF != null) t.inF = it.data.inF; if (it.data.outF != null) t.outF = it.data.outF; app.persist(); app.switchTab('titles'); }
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
    app.tabs.titles = { render, cta: () => ({ label: _T('Appliquer aux textes sélectionnés'), run: applySelection, enabled: true }), leave: () => { if (player) { player.stop(); player = null; } } };
  });
})(typeof self !== 'undefined' ? self : this);
