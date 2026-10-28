/* RR FX — onglet Textes : titres et paroles animés, posés sur les marqueurs ou les
   temps forts, à partir d'un modèle de texte Premiere (.mogrt). */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Core, Lib, Store, Host, Pv } = app;
    const { h, hotText, actionGroup, picker, row, section, Player } = app.UI;

    const DEFAULTS = { mogrt: '', text: '', split: 'lines', timing: 'markers', from: 'playhead', gap: 2, maxDur: 0, fixed: 1.5, anim: 'pop', inF: 6, outF: 5, params: {} };
    // Complète les réglages sans remplacer l'objet (l'interface garde une référence dessus).
    const st = () => {
      const s = app.settings();
      if (!s.titles || typeof s.titles !== 'object') s.titles = {};
      Object.keys(DEFAULTS).forEach(k => { if (!(k in s.titles)) s.titles[k] = k === 'params' ? {} : DEFAULTS[k]; });
      return s.titles;
    };
    const anim = () => Lib.titleById[st().anim] || Lib.titleById.pop;
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
      if (!Store.fs) return [{ path: 'demo.mogrt', name: 'Titre simple (démo)' }];
      const P = Store.path, dirs = [userDir()];
      const appData = (root.process && root.process.env && root.process.env.APPDATA) || '';
      dirs.push(appData ? P.join(appData, 'Adobe', 'Common', 'Motion Graphics Templates')
        : P.join(Store.os.homedir(), 'Library', 'Application Support', 'Adobe', 'Common', 'Motion Graphics Templates'));
      const appPath = app.S.compat && app.S.compat.appPath;
      if (appPath) [P.join(appPath, 'Essential Graphics'), P.join(appPath, 'Contents', 'Essential Graphics'), P.join(P.dirname(appPath), 'Essential Graphics')].forEach(d => dirs.push(d));
      const seen = {}, out = [];
      dirs.forEach(d => Store.listFiles(d, /\.mogrt$/i, 300, 4).forEach(f => {
        if (seen[f]) return;
        seen[f] = true;
        out.push({ path: f, name: P.basename(f, P.extname(f)) + (f.indexOf(userDir()) === 0 ? '' : '  ·  ' + P.basename(P.dirname(f))) });
      }));
      out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return out;
    }
    function addMogrt() {
      const files = Store.pickFiles('Choisir un modèle de texte (.mogrt)', ['mogrt']);
      if (files === null) return app.status.finish('warn', 'Disponible dans Premiere', 'Le choix de fichier passe par Premiere.');
      files.forEach(f => Store.fs.copyFileSync(f, Store.path.join(userDir(), Store.path.basename(f))));
      found = null;
      if (files.length) st().mogrt = Store.path.join(userDir(), Store.path.basename(files[0]));
      app.persist();
      app.switchTab('titles');
    }

    // ---------------------------------------------------------------- calcul des textes

    async function timeline() {
      const t = st(), fps = app.fps();
      const chunks = Core.splitLyrics(t.text, t.split);
      if (!chunks.length) throw new Error('Écris (ou colle) le texte ou les paroles.');
      const r = await Host.call('markerList', {});
      if (!r.ok) throw new Error(r.error);
      const from = t.from === 'selection' && r.range ? r.range.a : t.from === 'start' ? 0 : r.playhead;
      let times = null;
      if (t.timing === 'markers') {
        times = r.markers.map(m => m.t);
        if (!times.filter(x => x >= from - 1e-6).length) throw new Error('Aucun marqueur après le point de départ : pose les temps forts (onglet Musique) ou des marqueurs (touche M).');
      } else if (t.timing === 'beats') {
        times = await app.services.beatTimes();
      }
      const items = Core.titleTimeline(chunks, times, { from, fixed: t.timing === 'fixed' ? t.fixed : 0, gap: t.gap / fps, lastDur: 2, maxDur: t.maxDur || 0 });
      if (items.length < chunks.length) app.log((chunks.length - items.length) + ' texte(s) sans temps disponible : ajoute des marqueurs.', 'warn');
      return items;
    }

    function place() {
      const t = st();
      return app.runTask('Textes', async () => {
        if (!t.mogrt) return { kind: 'error', title: 'Choisis un modèle de texte', detail: 'Section « Modèle de texte » : un .mogrt (Premiere en fournit, ou exporte le tien).' };
        app.status.phase('Calcul des temps');
        const items = await timeline();
        if (!items.length) return { kind: 'warn', title: 'Aucun texte posé', detail: 'Pas de temps disponible.' };
        app.status.phase('Pose des textes');
        const fps = app.fps(), created = [], warnings = [];
        let track = null;
        for (let i = 0; i < items.length; i++) {
          if (app.S.cancel) break;
          const it = items[i];
          app.status.progress(i, items.length, it.text);
          const frames = Math.max(1, Math.round((it.end - it.start) * fps));
          const fx = Core.titleSpec(anim(), animParams(), frames, t.inF, t.outF, fps, app.registry());
          const r = await Host.call('placeTitle', { mogrt: t.mogrt, start: it.start, end: it.end, text: it.text, fx, track, spanEnd: items[items.length - 1].end, minTrack: 1 });
          if (!r.ok) {
            if (!created.length) return { kind: 'error', title: 'Textes non posés', detail: r.error };
            warnings.push(it.text + ' : ' + r.error);
            continue;
          }
          track = r.track;
          created.push.apply(created, r.created);
          warnings.push.apply(warnings, r.warnings);
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: 'Textes × ' + created.length, entries: created });
        Array.from(new Set(warnings)).forEach(w => app.log(w, 'warn'));
        return { kind: warnings.length ? 'warn' : 'ok', title: app.plural(created.length, 'texte posé', 'textes posés') + (track !== null ? ' sur V' + (track + 1) : ''), detail: 'Animation « ' + anim().name + ' » · modifiables dans Options d\'effet et Objets graphiques essentiels.' };
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
      const sample = Core.splitLyrics(t.text, t.split)[0] || 'Tes paroles ici';
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
          g.font = '800 ' + Math.round(H * 0.11) + 'px ' + app.UI.css('--font');
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = H * 0.012;
          g.strokeStyle = 'rgba(0,0,0,0.55)';
          g.strokeText(sample, 0, 0);
          g.fillStyle = '#fff';
          g.fillText(sample, 0, 0);
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

      const add = h('button', { class: 'action' }, 'Ajouter un .mogrt…');
      add.addEventListener('click', addMogrt);
      const rescan = h('button', { class: 'action quiet' }, 'Rafraîchir');
      rescan.addEventListener('click', () => { found = null; render(view); });
      const opts = found.map(f => ({ v: f.path, label: f.name }));
      if (t.mogrt && !opts.some(o => o.v === t.mogrt)) opts.unshift({ v: t.mogrt, label: Store.path ? Store.path.basename(t.mogrt) : t.mogrt });
      view.appendChild(section('Modèle de texte', [
        opts.length ? row('Modèle', picker(opts, t.mogrt, v => { t.mogrt = v; app.persist(); })) : h('div', { class: 'note' }, 'Aucun modèle trouvé.'),
        h('div', { class: 'row-buttons' }, add, rescan),
        h('div', { class: 'note' }, 'Pour utiliser ta police et ton style : crée un texte dans Premiere (outil Texte), règle-le dans « Objets graphiques essentiels », puis clic droit sur le clip > Exporter comme modèle d\'animations graphiques, et ajoute le fichier ici.')
      ]));

      const ta = h('textarea', { class: 'code lyrics', rows: 6, spellcheck: 'true', placeholder: 'Une ligne par texte (ou un mot par marqueur)…' }, t.text);
      const count = h('div', { class: 'note' });
      const updateCount = () => { count.textContent = app.plural(Core.splitLyrics(t.text, t.split).length, 'texte') + ' à poser.'; };
      ta.addEventListener('input', () => { t.text = ta.value; updateCount(); app.persist(); });
      updateCount();
      view.appendChild(section('Texte et paroles', [
        ta,
        row('Découpage', actionGroup([{ v: 'lines', label: 'Une ligne par texte' }, { v: 'words', label: 'Un mot par texte' }], t.split, v => { t.split = v; updateCount(); app.persist(); })),
        count
      ]));

      const fixedRow = row('Durée de chaque texte', hotText({ value: t.fixed, min: 0.2, max: 20, step: 0.1, unit: 's', onChange: v => { t.fixed = v; app.persist(); } }));
      const timingPick = picker([
        { v: 'markers', label: 'Marqueurs de la séquence' },
        { v: 'beats', label: 'Temps forts détectés' },
        { v: 'fixed', label: 'Durée fixe' }
      ], t.timing, v => { t.timing = v; fixedRow.classList.toggle('hidden', v !== 'fixed'); app.persist(); });
      fixedRow.classList.toggle('hidden', t.timing !== 'fixed');
      view.appendChild(section('Placement', [
        row('Un texte par', timingPick),
        fixedRow,
        row('À partir de', picker([{ v: 'playhead', label: 'La tête de lecture' }, { v: 'selection', label: 'Début des clips sélectionnés' }, { v: 'start', label: 'Début de la séquence' }], t.from, v => { t.from = v; app.persist(); })),
        row('Écart entre deux textes', hotText({ value: t.gap, min: 0, max: 50, step: 1, unit: 'i', onChange: v => { t.gap = v; app.persist(); } })),
        row('Durée maximum', hotText({ value: t.maxDur, min: 0, max: 30, step: 0.5, unit: 's', onChange: v => { t.maxDur = v; app.persist(); } }), { title: '0 = jusqu\'au temps suivant' })
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
      view.appendChild(section('Animation', [
        row('Style', picker(Lib.TITLE_ANIMS.map(a => ({ v: a.id, label: a.name })), t.anim, v => { t.anim = v; renderParams(); rebuild(); })),
        row('Entrée', hotText({ value: t.inF, min: 0, max: 60, step: 1, unit: 'i', onChange: (v, fin) => { t.inF = v; if (fin) rebuild(); } })),
        row('Sortie', hotText({ value: t.outF, min: 0, max: 60, step: 1, unit: 'i', onChange: (v, fin) => { t.outF = v; if (fin) rebuild(); } })),
        params,
        h('div', { class: 'preview' }, h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, 'Aperçu simulé')))
      ]));
      preview(cv);
    }

    app.tabs.titles = { render, cta: () => ({ label: 'Poser les textes', run: place, enabled: true }), leave: () => { if (player) { player.stop(); player = null; } } };
  });
})(typeof self !== 'undefined' ? self : this);
