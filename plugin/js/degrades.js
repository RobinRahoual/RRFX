/* RR FX : dégradés de couleur (onglet Couleur). Un dégradé (2 couleurs, angle, linéaire ou
   radial) fondu sur l'image avec un mode de fusion : ciel plus orangé, teinte de marque, vignette
   chaude… Posé sur un calque de réglage (effet Dégradé de Premiere + mode de fusion de
   l'Opacité), sur le clip visé ou toute la séquence. Dégradés fournis, les tiens dans Mes effets,
   import d'un dégradé CSS (copié d'un site comme uiGradients, CSS Gradient…). */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const C = root.RRFXCouleurs, { Host, Pv } = app;
    const { h, hotText, actionGroup, picker, row } = app.UI;
    // Modes de fusion (valeur de Premiere, nom, équivalent canvas pour l'aperçu).
    const BLENDS = [
      { v: 13, label: 'Lumière tamisée', css: 'soft-light' }, { v: 12, label: 'Incrustation', css: 'overlay' },
      { v: 3, label: 'Produit', css: 'multiply' }, { v: 8, label: 'Écran', css: 'screen' }, { v: 0, label: 'Normal', css: 'source-over' }
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
    function draw(cv, x) {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, gr = x.g;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.drawImage(Pv.shots()[Pv.isReal() ? 'B' : 'A'], 0, 0, W, H);
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
      return app.runTask('Dégradé de couleur', async () => {
        const r = await Host.call('resolve', x.target === 'sequence' ? { placement: 'sequence', sides: ['post'], frames: 1, target: 'adjustment' } : { placement: 'full', sides: ['post'], frames: 1, target: 'adjustment' });
        if (!r.ok) return { kind: 'error', title: 'Aucun clip visé', detail: r.error };
        const names = await Host.call('listEffects', { filter: 'ramp|grad|verlauf|rampa' });
        const fx = fxOf(x);
        if (names.ok && names.names.length) fx[0].names = names.names.filter(n => !/4|quatre|vier|cuatro|quattro/i.test(n)).concat(RAMP_NAMES);
        const name = 'RR FX · Dégradé';
        const res = await Host.call('apply', { target: 'adjustment', name, targets: r.targets.map(t => Object.assign({}, t, { name, fx })), adjNodeId: app.settings().adjNodeId, refreshAdj: true });
        if (!res.ok) return { kind: 'error', title: 'Dégradé non posé', detail: res.error };
        if (res.created && res.created.length) app.pushHistory({ date: Date.now(), label: 'Dégradé', entries: res.created });
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        return { kind: res.warnings && res.warnings.length ? 'warn' : 'ok', title: 'Dégradé posé', detail: 'Calque de réglage « RR FX · Dégradé » (effet Dégradé + mode de fusion), réglable dans Options d\'effet.' };
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
        if (x.preset === 'custom') opts.unshift({ v: 'custom', label: 'Mon réglage' });
        box.appendChild(row('Dégradé', picker(opts, x.preset.indexOf(':') > 0 || x.preset === 'custom' ? x.preset : 'b:' + x.preset, v => {
          const p = v.indexOf('b:') === 0 ? C.GRADIENTS.find(q => 'b:' + q.id === v) : null, u = v.indexOf('u:') === 0 ? app.S.lib.items.find(i => 'u:' + i.id === v) : null;
          if (p) x.g = JSON.parse(JSON.stringify(p.g)); else if (u) x.g = JSON.parse(JSON.stringify(u.data.g));
          x.preset = v; app.persist(); refresh();
        })));
        const swatch = h('div', { class: 'grad-swatch', style: { background: C.gradientCss(x.g) } });
        box.appendChild(h('div', { class: 'preview' }, h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, 'Aperçu'))));
        const custom = () => { x.preset = 'custom'; swatch.style.background = C.gradientCss(x.g); app.persist(); redraw(); };
        box.appendChild(row('Couleur 1', app.services.colorPick(x.g.colors[0], v => { x.g.colors[0] = v || '#ffffff'; custom(); })));
        box.appendChild(row('Couleur 2', app.services.colorPick(x.g.colors[x.g.colors.length - 1], v => { x.g.colors[x.g.colors.length - 1] = v || '#000000'; custom(); })));
        box.appendChild(row('Forme', actionGroup([{ v: 'linear', label: 'Linéaire' }, { v: 'radial', label: 'Radial' }], x.g.type, v => { x.g.type = v; custom(); })));
        box.appendChild(row('Angle', hotText({ value: x.g.angle, min: 0, max: 359, step: 5, unit: '°', onChange: v => { x.g.angle = v; custom(); } })));
        box.appendChild(row('Fusion', picker(BLENDS.map(b => ({ v: String(b.v), label: b.label })), String(x.blend), v => { x.blend = +v; app.persist(); redraw(); })));
        box.appendChild(row('Intensité', hotText({ value: x.opacity, min: 0, max: 100, step: 5, unit: '%', onChange: v => { x.opacity = v; app.persist(); redraw(); } })));
        box.appendChild(row('Sur', actionGroup([{ v: 'clip', label: 'Clip visé' }, { v: 'sequence', label: 'Toute la séquence' }], x.target, v => { x.target = v; app.persist(); })));
        box.appendChild(swatch);
        const go = h('button', { class: 'action go' }, 'Appliquer le dégradé');
        go.addEventListener('click', apply);
        const save = h('button', { class: 'action' }, 'Enregistrer…');
        save.addEventListener('click', async () => {
          const name = await app.promptName('Nom du dégradé', 'Mon dégradé');
          if (!name) return;
          app.services.addItems([{ type: 'gradient', name, data: { g: JSON.parse(JSON.stringify(x.g)), blend: x.blend, opacity: x.opacity } }]);
          const it = userGradients().filter(i => i.name === name).pop();
          if (it) x.preset = 'u:' + it.id;
          app.persist(); refresh();
          app.status.finish('ok', 'Dégradé « ' + name + ' » enregistré', 'Dans Mes effets : exportable et partageable.');
        });
        const paste = h('button', { class: 'action' }, 'Coller du CSS…');
        paste.addEventListener('click', async () => {
          const field = h('textarea', { class: 'code', rows: 3, placeholder: 'linear-gradient(90deg, #ff7e5f, #feb47b)' });
          setTimeout(() => field.focus(), 0);
          const text = await app.modal('Importer un dégradé', h('div', null, field, h('div', { class: 'note' }, 'Un dégradé CSS (uiGradients, CSS Gradient, Figma…) ou deux couleurs.')), [{ label: 'Annuler', value: null }, { label: 'Importer', primary: true, value: () => field.value }]);
          if (!text) return;
          const gr = C.parseGradient(text);
          if (!gr) return app.status.finish('warn', 'Dégradé non reconnu', 'Il faut au moins deux couleurs.');
          x.g = gr; x.preset = 'custom'; app.persist(); refresh();
        });
        box.appendChild(h('div', { class: 'row-buttons' }, go, save, paste));
        requestAnimationFrame(redraw);
      };
      refresh();
      return makePanel('gradient', 'Dégradés de couleur', [box]);
    }

    app.itemTypes.gradient = {
      icon: '▤', label: 'Dégradé', valid: d => !!d.g && Array.isArray(d.g.colors) && d.g.colors.length >= 2,
      meta: it => it.data.g.colors.join(' → '),
      open: it => { const x = st(); x.g = JSON.parse(JSON.stringify(it.data.g)); if (it.data.blend != null) x.blend = it.data.blend; if (it.data.opacity != null) x.opacity = it.data.opacity; x.preset = 'u:' + it.id; app.persist(); app.switchTab('color'); }
    };
    app.gradients = { panel, apply, fxOf };
  });
})(typeof self !== 'undefined' ? self : this);
