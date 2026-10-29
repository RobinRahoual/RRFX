/* RR FX : dégradés de couleur (onglet Couleur). Un dégradé (2 couleurs, angle, linéaire ou
   radial) fondu sur l'image avec un mode de fusion : ciel plus orangé, teinte de marque, vignette
   chaude… Posé sur un calque de réglage (effet Dégradé de Premiere + mode de fusion de
   l'Opacité), sur le clip visé ou toute la séquence. Dégradés fournis, les tiens dans Mes effets,
   import d'un dégradé CSS (copié d'un site comme uiGradients, CSS Gradient…). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const C = root.RRFXCouleurs, { Host, Pv } = app;
    const { h, hotText, actionGroup, picker, row } = app.UI;
    // Modes de fusion (valeur de Premiere, nom, équivalent canvas pour l'aperçu).
    const BLENDS = [
      { v: 13, label: _T('Lumière tamisée'), css: 'soft-light' }, { v: 12, label: _T('Incrustation'), css: 'overlay' },
      { v: 3, label: _T('Produit'), css: 'multiply' }, { v: 8, label: _T('Écran'), css: 'screen' }, { v: 0, label: 'Normal', css: 'source-over' }
    ];
    const RAMP_NAMES = ['Ramp', 'Dégradé', 'Verlauf', 'Rampa', 'Gradiente'];

    const st = () => {
      const s = app.settings();
      if (!s.gradient || typeof s.gradient !== 'object') s.gradient = {};
      const d = { g: C.GRADIENTS[0].g, preset: C.GRADIENTS[0].id, blend: 13, opacity: 45, target: 'clip' };
      Object.keys(d).forEach(k => { if (!(k in s.gradient)) s.gradient[k] = JSON.parse(JSON.stringify(d[k])); });
      return s.gradient;
    };
    const userGradients = () => app.S.lib.items.filter(i => i.type === 'gradient');

    // Aperçu : le plan de test (ou ta vraie image), le dégradé fondu par-dessus.
    function draw(cv, x, before) {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, gr = x.g;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.drawImage(Pv.shots()[Pv.isReal() ? 'B' : 'A'], 0, 0, W, H);
      if (before) return;
      const r = C.rampOf(gr);
      let fill;
      if (gr.type === 'radial') { fill = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2); } else fill = g.createLinearGradient(r.start[0] * W, r.start[1] * H, r.end[0] * W, r.end[1] * H);
      fill.addColorStop(0, gr.colors[0]);
      fill.addColorStop(1, gr.colors[gr.colors.length - 1]);
      g.globalCompositeOperation = (BLENDS.find(b => b.v === x.blend) || BLENDS[0]).css;
      g.globalAlpha = x.opacity / 100;
      g.fillStyle = fill;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }

    // Effets du calque : Dégradé (couleurs, points, forme) puis Opacité (quantité, mode de fusion).
    function fxOf(x) {
      const r = C.rampOf(x.g);
      return [
        { type: 'ramp', names: RAMP_NAMES, matchName: 'AE.ADBE Ramp', props: [
          { key: 'start', index: 0, point: true, static: r.start }, { key: 'startColor', index: 1, color: true, static: r.startColor },
          { key: 'end', index: 2, point: true, static: r.end }, { key: 'endColor', index: 3, color: true, static: r.endColor },
          { key: 'shape', index: 4, static: r.shape }, { key: 'blend', index: 6, static: 0 }] },
        { type: 'opacity', names: [], matchName: 'AE.ADBE Opacity', intrinsic: 'opacity', props: [{ key: 'opacity', index: 0, static: x.opacity }, { key: 'blend', index: 1, static: x.blend }] }
      ];
    }

    function apply() {
      const x = st();
      return app.runTask(_T('Dégradé de couleur'), async () => {
        const names = await Host.call('listEffects', { filter: 'ramp|grad|verlauf|rampa' });
        const fx = fxOf(x);
        if (names.ok && names.names.length) fx[0].names = names.names.filter(n => !/4|quatre|vier|cuatro|quattro/i.test(n)).concat(RAMP_NAMES);
        const { res, fail } = await app.services.adjustmentLayer('RR FX · Dégradé', fx, { scope: x.target });
        if (fail) return fail;
        return { kind: res.kind, title: _T('Dégradé posé'), detail: _T('Calque de réglage « RR FX · Dégradé » (effet Dégradé + mode de fusion), réglable dans Options d\'effet.') };
      });
    }

    function panel(makePanel) {
      const box = h('div');
      const refresh = () => {
        const x = st();
        box.innerHTML = '';
        const cv = h('canvas', { class: 'pv-canvas', width: 480, height: 270 });
        const redraw = () => draw(cv, x);
        const opts = C.GRADIENTS.map(p => ({ v: 'b:' + p.id, label: p.name })).concat(userGradients().map(i => ({ v: 'u:' + i.id, label: '★ ' + i.name })));
        if (x.preset === 'custom') opts.unshift({ v: 'custom', label: _T('Mon réglage') });
        box.appendChild(row(_T('Dégradé'), picker(opts, x.preset.indexOf(':') > 0 || x.preset === 'custom' ? x.preset : 'b:' + x.preset, v => {
          const p = v.indexOf('b:') === 0 ? C.GRADIENTS.find(q => 'b:' + q.id === v) : null, u = v.indexOf('u:') === 0 ? app.S.lib.items.find(i => 'u:' + i.id === v) : null;
          if (p) x.g = JSON.parse(JSON.stringify(p.g)); else if (u) x.g = JSON.parse(JSON.stringify(u.data.g));
          x.preset = v; app.persist(); refresh();
        })));
        const swatch = h('div', { class: 'grad-swatch', style: { background: C.gradientCss(x.g) } });
        // Maintenir le clic sur l'aperçu : l'image sans le dégradé.
        const frame = h('div', { class: 'pv-frame', title: _T('Maintiens le clic pour voir l\'avant') }, cv, h('span', { class: 'pv-label' }, _T('Aperçu · maintiens pour l\'avant')));
        frame.addEventListener('pointerdown', () => draw(cv, x, true));
        ['pointerup', 'pointerleave'].forEach(ev => frame.addEventListener(ev, redraw));
        box.appendChild(h('div', { class: 'preview' }, frame));
        const custom = () => { x.preset = 'custom'; swatch.style.background = C.gradientCss(x.g); app.persist(); redraw(); };
        box.appendChild(row(_T('Couleur 1'), app.services.colorPick(x.g.colors[0], v => { x.g.colors[0] = v || '#ffffff'; custom(); })));
        box.appendChild(row(_T('Couleur 2'), app.services.colorPick(x.g.colors[x.g.colors.length - 1], v => { x.g.colors[x.g.colors.length - 1] = v || '#000000'; custom(); })));
        box.appendChild(row(_T('Forme'), actionGroup([{ v: 'linear', label: _T('Linéaire') }, { v: 'radial', label: 'Radial' }], x.g.type, v => { x.g.type = v; custom(); })));
        box.appendChild(row('Angle', hotText({ value: x.g.angle, min: 0, max: 359, step: 5, unit: '°', onChange: v => { x.g.angle = v; custom(); } })));
        box.appendChild(row(_T('Fusion'), picker(BLENDS.map(b => ({ v: String(b.v), label: b.label })), String(x.blend), v => { x.blend = +v; app.persist(); redraw(); })));
        box.appendChild(row(_T('Intensité'), hotText({ value: x.opacity, min: 0, max: 100, step: 5, unit: '%', onChange: v => { x.opacity = v; app.persist(); redraw(); } })));
        box.appendChild(row(_T('Sur'), actionGroup([{ v: 'clip', label: _T('Clip visé') }, { v: 'sequence', label: _T('Toute la séquence') }], x.target, v => { x.target = v; app.persist(); })));
        box.appendChild(swatch);
        const go = h('button', { class: 'action go' }, _T('Appliquer le dégradé'));
        go.addEventListener('click', apply);
        const save = h('button', { class: 'action' }, _T('Enregistrer…'));
        save.addEventListener('click', async () => {
          const name = await app.promptName(_T('Nom du dégradé'), _T('Mon dégradé'));
          if (!name) return;
          app.services.addItems([{ type: 'gradient', name, data: { g: JSON.parse(JSON.stringify(x.g)), blend: x.blend, opacity: x.opacity } }]);
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
      return makePanel('gradient', _T('Dégradés de couleur'), [box]);
    }

    app.itemTypes.gradient = {
      icon: '▤', label: _T('Dégradé'), valid: d => !!d.g && Array.isArray(d.g.colors) && d.g.colors.length >= 2,
      meta: it => it.data.g.colors.join(' → '),
      open: it => { const x = st(); x.g = JSON.parse(JSON.stringify(it.data.g)); if (it.data.blend != null) x.blend = it.data.blend; if (it.data.opacity != null) x.opacity = it.data.opacity; x.preset = 'u:' + it.id; app.persist(); app.switchTab('color'); }
    };
    app.gradients = { panel, apply, fxOf };
  });
})(typeof self !== 'undefined' ? self : this);
