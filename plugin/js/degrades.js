/* RR FX : dégradés sur les textes, formes et logos (onglet Textes). Un dégradé (2 couleurs, angle,
   linéaire ou radial) posé avec l'effet Dégradé de Premiere directement sur l'élément sélectionné :
   il ne remplit que ses pixels. Dégradés fournis, les tiens dans Mes effets, import d'un dégradé
   CSS (copié d'un site comme uiGradients, CSS Gradient…). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const C = root.RRFXCouleurs, { Host } = app;
    const { h, hotText, actionGroup, picker, row } = app.UI;
    const RAMP_NAMES = ['Ramp', 'Dégradé', 'Verlauf', 'Rampa', 'Gradiente'];

    const st = () => {
      const s = app.settings();
      if (!s.gradient || typeof s.gradient !== 'object') s.gradient = {};
      // Avant la 2.11.1, le dégradé se fondait sur l'image (mode de fusion, 45 %) : sur un texte, plein.
      if ('blend' in s.gradient) { delete s.gradient.blend; delete s.gradient.target; s.gradient.opacity = 100; }
      const d = { g: C.GRADIENTS[0].g, preset: C.GRADIENTS[0].id, opacity: 100 };
      Object.keys(d).forEach(k => { if (!(k in s.gradient)) s.gradient[k] = JSON.parse(JSON.stringify(d[k])); });
      return s.gradient;
    };
    const userGradients = () => app.S.lib.items.filter(i => i.type === 'gradient');

    // Aperçu : un titre rempli du dégradé, sur fond sombre (comme dans Premiere sur un texte).
    function draw(cv, x) {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, gr = x.g;
      g.fillStyle = '#1b1b1f';
      g.fillRect(0, 0, W, H);
      const r = C.rampOf(gr);
      let fill;
      if (gr.type === 'radial') fill = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      else fill = g.createLinearGradient(r.start[0] * W, r.start[1] * H, r.end[0] * W, r.end[1] * H);
      fill.addColorStop(0, gr.colors[0]);
      fill.addColorStop(1, gr.colors[gr.colors.length - 1]);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 ' + Math.round(H * 0.32) + 'px system-ui, sans-serif';
      // Intensité : le dégradé mélangé à la couleur d'origine du texte (blanc).
      g.fillStyle = '#ffffff';
      g.fillText(_T('TITRE'), W / 2, H * 0.42);
      g.globalAlpha = x.opacity / 100;
      g.fillStyle = fill;
      g.fillText(_T('TITRE'), W / 2, H * 0.42);
      g.globalAlpha = 1;
      g.fillStyle = fill;
      g.fillRect(W * 0.2, H * 0.72, W * 0.6, H * 0.1);
    }

    // Effet Dégradé de Premiere posé sur le texte ou la forme : il remplit seulement ses pixels.
    // « Mélange avec l'original » = 100 - intensité.
    function fxOf(x) {
      const r = C.rampOf(x.g);
      return [
        { type: 'ramp', names: RAMP_NAMES, matchName: 'AE.ADBE Ramp', props: [
          { key: 'start', index: 0, point: true, static: r.start }, { key: 'startColor', index: 1, color: true, static: r.startColor },
          { key: 'end', index: 2, point: true, static: r.end }, { key: 'endColor', index: 3, color: true, static: r.endColor },
          { key: 'shape', index: 4, static: r.shape }, { key: 'blend', index: 6, static: Math.max(0, Math.min(100, 100 - x.opacity)) }] }
      ];
    }

    function apply() {
      const x = st();
      return app.runTask(_T('Dégradé'), async () => {
        const r = await Host.call('resolve', { placement: 'full', strict: true, sides: ['post'], frames: 1, target: 'clip' });
        if (!r.ok) return { kind: 'warn', title: _T('Aucun texte sélectionné'), detail: _T('Sélectionne un texte, une forme ou un logo dans la timeline, puis recommence.') };
        const names = await Host.call('listEffects', { filter: 'ramp|grad|verlauf|rampa' });
        const fx = fxOf(x);
        if (names.ok && names.names.length) fx[0].names = names.names.filter(n => !/4|quatre|vier|cuatro|quattro/i.test(n)).concat(RAMP_NAMES);
        const res = await Host.call('apply', { target: 'clip', name: 'RR FX · Dégradé', targets: r.targets.map(t => Object.assign({}, t, { name: 'RR FX · Dégradé', fx })) });
        if (!res.ok) return { kind: 'error', title: _T('Dégradé non posé'), detail: res.error };
        if (res.created && res.created.length) app.pushHistory({ date: Date.now(), label: _T('Dégradé'), entries: res.created });
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        return { kind: res.warnings && res.warnings.length ? 'warn' : 'ok', title: _T('Dégradé posé') + ' · ' + app.plural(r.targets.length, _T('élément'), _T('éléments')), detail: _T('Effet Dégradé sur le texte ou la forme : points et couleurs réglables dans Options d\'effet.') };
      });
    }

    function render() {
      const box = h('div');
      const refresh = () => {
        const x = st();
        box.innerHTML = '';
        const cv = h('canvas', { class: 'pv-canvas', width: 480, height: 200 });
        const redraw = () => draw(cv, x);
        const opts = C.GRADIENTS.map(p => ({ v: 'b:' + p.id, label: p.name })).concat(userGradients().map(i => ({ v: 'u:' + i.id, label: '★ ' + i.name })));
        if (x.preset === 'custom') opts.unshift({ v: 'custom', label: _T('Mon réglage') });
        box.appendChild(h('div', { class: 'note' }, _T('Remplis un texte, une forme ou un logo d\'un dégradé : sélectionne-le dans la timeline, choisis les couleurs, puis « Appliquer le dégradé ».')));
        box.appendChild(row(_T('Dégradé'), picker(opts, x.preset.indexOf(':') > 0 || x.preset === 'custom' ? x.preset : 'b:' + x.preset, v => {
          const p = v.indexOf('b:') === 0 ? C.GRADIENTS.find(q => 'b:' + q.id === v) : null, u = v.indexOf('u:') === 0 ? app.S.lib.items.find(i => 'u:' + i.id === v) : null;
          if (p) x.g = JSON.parse(JSON.stringify(p.g)); else if (u) x.g = JSON.parse(JSON.stringify(u.data.g));
          x.preset = v; app.persist(); refresh();
        })));
        box.appendChild(h('div', { class: 'preview' }, h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, _T('Aperçu')))));
        const custom = () => { x.preset = 'custom'; app.persist(); redraw(); };
        box.appendChild(row(_T('Couleur 1'), app.services.colorPick(x.g.colors[0], v => { x.g.colors[0] = v || '#ffffff'; custom(); })));
        box.appendChild(row(_T('Couleur 2'), app.services.colorPick(x.g.colors[x.g.colors.length - 1], v => { x.g.colors[x.g.colors.length - 1] = v || '#000000'; custom(); })));
        box.appendChild(row(_T('Forme'), actionGroup([{ v: 'linear', label: _T('Linéaire') }, { v: 'radial', label: 'Radial' }], x.g.type, v => { x.g.type = v; custom(); })));
        box.appendChild(row('Angle', hotText({ value: x.g.angle, min: 0, max: 359, step: 5, unit: '°', onChange: v => { x.g.angle = v; custom(); } })));
        box.appendChild(row(_T('Intensité'), hotText({ value: x.opacity, min: 0, max: 100, step: 5, unit: '%', onChange: v => { x.opacity = v; app.persist(); redraw(); } })));
        const go = h('button', { class: 'action go' }, _T('Appliquer le dégradé'));
        go.addEventListener('click', apply);
        const save = h('button', { class: 'action' }, _T('Enregistrer…'));
        save.addEventListener('click', async () => {
          const name = await app.promptName(_T('Nom du dégradé'), _T('Mon dégradé'));
          if (!name) return;
          app.services.addItems([{ type: 'gradient', name, data: { g: JSON.parse(JSON.stringify(x.g)), opacity: x.opacity } }]);
          const it = userGradients().filter(i => i.name === name).pop();
          if (it) x.preset = 'u:' + it.id;
          app.persist(); refresh();
          app.status.finish('ok', _T('Dégradé « ') + name + _T(' » enregistré'), _T('Dans Mes effets : exportable et partageable.'));
        });
        const paste = h('button', { class: 'action' }, _T('Coller du CSS…'));
        paste.addEventListener('click', async () => {
          const field = h('textarea', { class: 'code', rows: 3, placeholder: 'linear-gradient(90deg, #ff7e5f, #feb47b)' });
          setTimeout(() => field.focus(), 0);
          const text = await app.modal(_T('Importer un dégradé'), h('div', null, field, h('div', { class: 'note' }, _T('Un dégradé CSS (uiGradients, CSS Gradient, Figma…) ou deux couleurs.'))), [{ label: _T('Annuler'), value: null }, { label: _T('Importer'), primary: true, value: () => field.value }]);
          if (!text) return;
          const gr = C.parseGradient(text);
          if (!gr) return app.status.finish('warn', _T('Dégradé non reconnu'), _T('Il faut au moins deux couleurs.'));
          x.g = gr; x.preset = 'custom'; app.persist(); refresh();
        });
        box.appendChild(h('div', { class: 'row-buttons' }, go, save, paste));
        requestAnimationFrame(redraw);
      };
      refresh();
      return [box];
    }

    app.extras.titles.push({ id: 'degrade', title: _T('Dégradé sur un texte ou une forme'), nav: _T('Dégradé'), tool: [_T('Appliquer le dégradé'), () => apply()], render });

    app.itemTypes.gradient = {
      icon: '▤', label: _T('Dégradé'), valid: d => !!d.g && Array.isArray(d.g.colors) && d.g.colors.length >= 2,
      meta: it => it.data.g.colors.join(' → '),
      open: it => { const x = st(); x.g = JSON.parse(JSON.stringify(it.data.g)); if (it.data.opacity != null) x.opacity = it.data.opacity; x.preset = 'u:' + it.id; app.persist(); app.switchTab('titles'); }
    };
    app.gradients = { apply, fxOf };
  });
})(typeof self !== 'undefined' ? self : this);
