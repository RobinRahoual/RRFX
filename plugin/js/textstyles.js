/* RR FX : styles de texte et Mes couleurs.
   - Mes couleurs : ta palette, proposée partout où l'on choisit une couleur (mots clés, styles de
     texte, dégradés). Ajout à la main, en collant des codes (#hex, rgb(), lien Coolors) ou en
     important un nuancier Adobe .ase ; export .ase pour Photoshop / Illustrator.
   - Styles de texte : police, taille, majuscules, couleur, contour, ombre, fond. Appliqués aux
     textes, sous-titres et bandeaux que RR FX pose. Enregistrés dans Mes effets (importables,
     partageables comme le reste). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const C = root.RRFXCouleurs, { Store, Pv } = app;
    const { h, hotText, picker, row, section, checkbox } = app.UI;
    const BASE = ['#ffffff', '#000000', '#ffd21e', '#ff4d4d', '#2ee6a8', '#38b6ff', '#c77dff', '#ff8c00'];

    // ---------------------------------------------------------------- Mes couleurs

    const myColors = () => {
      const s = app.settings();
      if (!Array.isArray(s.myColors)) s.myColors = [];
      return s.myColors;
    };
    function addColors(list) {
      const mine = myColors();
      let n = 0;
      list.map(C.hex).filter(Boolean).forEach(c => { if (mine.indexOf(c) < 0) { mine.push(c); n++; } });
      app.persist();
      return n;
    }

    /* Choix d'une couleur : tes couleurs, quelques couleurs de base, et le sélecteur du système.
       opts.none : propose « aucune ». */
    function colorPick(value, onChange, opts) {
      const o = opts || {}, box = h('div', { class: 'key-colors color-pick' });
      let cur = C.hex(value) || '';
      const draw = () => {
        box.innerHTML = '';
        if (o.none) {
          const n = h('button', { class: 'key-color none' + (!cur ? ' on' : ''), title: _T('Aucune'), 'aria-label': _T('Aucune couleur') }, '∅');
          n.addEventListener('click', () => { cur = ''; onChange(''); draw(); });
          box.appendChild(n);
        }
        const list = myColors().concat(BASE.filter(c => myColors().indexOf(c) < 0)).slice(0, 14);
        if (cur && list.indexOf(cur) < 0) list.unshift(cur);
        list.forEach(c => {
          const b = h('button', { class: 'key-color' + (c === cur ? ' on' : ''), style: { background: c }, title: c, 'aria-label': _T('Couleur ') + c });
          b.addEventListener('click', () => { cur = c; onChange(c); draw(); });
          box.appendChild(b);
        });
        const input = h('input', { type: 'color', class: 'key-color-input', value: cur || '#ffffff', title: _T('Autre couleur') });
        input.addEventListener('change', () => { cur = C.hex(input.value); addColors([cur]); onChange(cur); draw(); });
        box.appendChild(input);
      };
      draw();
      return box;
    }

    function colorsSection(refresh) {
      const box = h('div', { class: 'key-colors my-colors' });
      myColors().forEach(c => {
        const b = h('button', { class: 'key-color', style: { background: c }, title: c + _T(' · clic : retirer'), 'aria-label': _T('Retirer ') + c });
        b.addEventListener('click', () => { myColors().splice(myColors().indexOf(c), 1); app.persist(); refresh(); });
        box.appendChild(b);
      });
      const add = h('input', { type: 'color', class: 'key-color-input', title: _T('Ajouter une couleur'), value: '#ffd21e' });
      add.addEventListener('change', () => { addColors([add.value]); refresh(); });
      box.appendChild(add);
      const paste = h('button', { class: 'action' }, _T('Coller des codes…'));
      paste.addEventListener('click', async () => {
        const field = h('textarea', { class: 'code', rows: 3, placeholder: _T('#264653 #2a9d8f #e9c46a, rgb(244, 162, 97) ou un lien coolors.co/…') });
        setTimeout(() => field.focus(), 0);
        const text = await app.modal(_T('Ajouter des couleurs'), h('div', null, field, h('div', { class: 'note' }, _T('Codes #hex, rgb(…), ou lien d\'une palette Coolors, Adobe Color…'))), [{ label: _T('Annuler'), value: null }, { label: _T('Ajouter'), primary: true, value: () => field.value }]);
        if (!text) return;
        const n = addColors(C.parseColors(text));
        refresh();
        app.status.finish(n ? 'ok' : 'warn', n ? app.plural(n, _T('couleur ajoutée'), _T('couleurs ajoutées')) : _T('Aucune couleur reconnue'), n ? _T('Dans Mes couleurs.') : _T('Colle des codes #rrggbb ou rgb(r, g, b).'));
      });
      const imp = h('button', { class: 'action' }, _T('Importer .ase…'));
      imp.addEventListener('click', async () => {
        const files = await app.services.pickFiles(_T('Importer un nuancier Adobe (.ase)'), ['ase']);
        if (!files.length) return;
        const r = importAse(files);
        refresh();
        app.status.finish(r.n ? 'ok' : 'warn', r.n ? app.plural(r.n, _T('couleur ajoutée'), _T('couleurs ajoutées')) : _T('Aucune nouvelle couleur'), files.map(f => f.name).join(', '));
      });
      const exp = h('button', { class: 'action', disabled: !myColors().length }, _T('Exporter .ase…'));
      exp.addEventListener('click', () => {
        const out = Store.saveBinary ? Store.saveBinary([C.writeASE(myColors().map(c => ({ hex: c })))], _T('Mes couleurs RR FX.ase'), 'ase', _T('Exporter Mes couleurs')) : null;
        if (out) app.status.finish('ok', _T('Nuancier exporté'), out + _T(' : s\'ouvre dans Photoshop, Illustrator, Premiere (Lumetri : non).'));
      });
      const save = h('button', { class: 'action', disabled: !myColors().length, title: _T('Une palette dans Mes effets : à partager par code ou à publier') }, _T('Enregistrer comme palette…'));
      save.addEventListener('click', async () => {
        const name = await app.promptName(_T('Nom de la palette'), _T('Ma palette'));
        if (name) { app.services.addItems([{ type: 'palette', name, data: { colors: myColors().slice() } }]); app.status.finish('ok', _T('Palette enregistrée'), _T('Dans Mes effets.')); }
      });
      return section(_T('Mes couleurs'), [
        h('div', { class: 'note' }, myColors().length ? _T('Proposées partout où tu choisis une couleur. Clic sur une couleur : la retirer.') : _T('Ta palette (couleurs de ta marque…), proposée partout où tu choisis une couleur : mots clés, styles de texte, dégradés.')),
        box,
        h('div', { class: 'row-buttons' }, paste, imp),
        h('div', { class: 'row-buttons' }, exp, save)
      ]);
    }

    function importAse(files) {
      let n = 0;
      files.forEach(f => { n += addColors(C.parseASE(f.bytes).map(c => c.hex)); });
      return { n, what: _T('dans Mes couleurs') };
    }

    // ---------------------------------------------------------------- styles de texte

    const userStyles = () => app.S.lib.items.filter(i => i.type === 'textStyle');
    /* Choix possibles : le style du modèle (rien n'est changé), les styles fournis, les tiens. */
    const options = () => [{ v: '', label: _T('Celui du modèle .mogrt') }]
      .concat(C.STYLES.map(x => ({ v: 'b:' + x.id, label: x.name })))
      .concat(userStyles().map(i => ({ v: 'u:' + i.id, label: '★ ' + i.name })));
    function styleById(v) {
      if (!v) return null;
      if (v.indexOf('b:') === 0) { const b = C.STYLES.find(x => 'b:' + x.id === v); return b ? C.normStyle(b.style) : null; }
      const it = app.S.lib.items.find(i => 'u:' + i.id === v);
      return it ? C.normStyle(it.data.style) : null;
    }
    // Effets de repli (Teinte, Ombre portée) quand le modèle n'a pas ses propres réglages.
    function styleFx(st) {
      const reg = app.registry(), tint = reg.tint || {};
      return {
        fill: { type: 'tint', names: tint.names || ['Tint', 'Teinte'], matchName: 'AE.ADBE Tint', props: [{ key: 'black', index: 0, color: true, static: [0, 0, 0] }, { key: 'white', index: 1, color: true, static: C.rgb(st.fill) }, { key: 'amount', index: 2, static: 100 }] },
        shadow: { type: 'shadow', names: ['Drop Shadow', 'Ombre portée', 'Schlagschatten', 'Sombra paralela', 'Ombra esterna'], matchName: 'AE.ADBE Drop Shadow', props: [{ key: 'opacity', index: 1, static: 60 }, { key: 'distance', index: 3, static: 6 }, { key: 'softness', index: 4, static: 12 }] }
      };
    }

    /* Texte stylé centré en (x, y) ; base : taille du texte pour un style sans taille (px). Sert
       à l'aperçu du style et à celui des animations (onglet Textes). */
    function paint(g, text, st, x, y, base) {
      const H = g.canvas.height, t = st.caps ? text.toUpperCase() : text, size = Math.round(st.size ? H * Math.min(0.3, st.size / 600) : base);
      g.font = '800 ' + size + 'px ' + (st.font ? '"' + st.font.replace(/-/g, ' ') + '", ' : '') + app.UI.css('--font');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(t).width;
      if (st.box) { g.save(); g.globalAlpha *= st.boxOpacity / 100; g.fillStyle = st.box; g.fillRect(x - w / 2 - size * 0.4, y - size * 0.7, w + size * 0.8, size * 1.4); g.restore(); }
      if (st.shadow) { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = size * 0.25; g.shadowOffsetY = size * 0.08; }
      if (st.stroke && st.strokeWidth) { g.lineWidth = st.strokeWidth * size / 40; g.strokeStyle = st.stroke; g.lineJoin = 'round'; g.strokeText(t, x, y); }
      g.fillStyle = st.fill; g.fillText(t, x, y);
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    }
    // Aperçu : le texte stylé sur le plan de test.
    function drawStyle(cv, st, text) {
      const g = cv.getContext('2d');
      g.drawImage(Pv.shots().A, 0, 0, cv.width, cv.height);
      paint(g, text, st, cv.width / 2, cv.height * 0.74, cv.height * 0.13);
    }

    /* Section « Style du texte » : choix du style pour `owner` (objet de réglages, clé `key`),
       éditeur repliable pour créer ou modifier un style. */
    function styleSection(owner, key, title, sample, opts) {
      // opts.preview === false : l'onglet a son propre aperçu, on ne montre le nôtre qu'en édition.
      const own = !opts || opts.preview !== false;
      const box = h('div');
      let draft = null;
      const refresh = () => {
        box.innerHTML = '';
        const cur = owner[key] || '', st = styleById(cur) || C.normStyle({});
        const cv = h('canvas', { class: 'pv-canvas style-preview', width: 480, height: 200 });
        box.appendChild(row('Style', picker(options(), cur, v => { owner[key] = v; draft = null; app.persist(); refresh(); })));
        if (own || draft) { box.appendChild(cv); drawStyle(cv, draft || st, sample || _T('Ton texte ici')); }
        const edit = h('button', { class: 'action' }, draft ? _T('Fermer l\'éditeur') : (cur ? _T('Modifier / dupliquer…') : _T('Créer un style…')));
        edit.addEventListener('click', () => { draft = draft ? null : Object.assign({}, st); refresh(); });
        box.appendChild(h('div', { class: 'row-buttons' }, edit));
        if (draft) {
          const d = draft, redraw = () => drawStyle(cv, C.normStyle(d), sample || _T('Ton texte ici'));
          const font = h('input', { class: 'textfield', value: d.font, placeholder: _T('Police du modèle (ou ex. Montserrat-Bold)') });
          font.addEventListener('input', () => { d.font = font.value; redraw(); });
          box.appendChild(row(_T('Police'), font, { title: _T('Nom PostScript de la police installée (ex. Montserrat-ExtraBold). Vide : celle du modèle.') }));
          box.appendChild(row(_T('Taille'), hotText({ value: d.size, min: 0, max: 400, step: 1, unit: 'pt', onChange: v => { d.size = v; redraw(); } }), { title: _T('0 : celle du modèle') }));
          box.appendChild(row(_T('Couleur'), colorPick(d.fill, v => { d.fill = v || '#ffffff'; redraw(); })));
          box.appendChild(row(_T('Contour'), colorPick(d.stroke, v => { d.stroke = v; redraw(); }, { none: true })));
          box.appendChild(row(_T('Épaisseur'), hotText({ value: d.strokeWidth, min: 0, max: 40, step: 1, unit: '', onChange: v => { d.strokeWidth = v; redraw(); } })));
          box.appendChild(row(_T('Fond'), colorPick(d.box, v => { d.box = v; redraw(); }, { none: true })));
          box.appendChild(row(_T('Opacité du fond'), hotText({ value: d.boxOpacity, min: 0, max: 100, step: 5, unit: '%', onChange: v => { d.boxOpacity = v; redraw(); } })));
          box.appendChild(h('div', { class: 'row-buttons wrap' },
            checkbox(_T('Ombre'), d.shadow, v => { d.shadow = v; redraw(); }),
            checkbox('MAJUSCULES', d.caps, v => { d.caps = v; redraw(); })));
          const saveNew = h('button', { class: 'action go' }, _T('Enregistrer comme style…'));
          saveNew.addEventListener('click', async () => {
            const name = await app.promptName(_T('Nom du style'), _T('Mon style de texte'));
            if (!name) return;
            app.services.addItems([{ type: 'textStyle', name, data: { style: C.normStyle(d) } }]);
            const it = userStyles().filter(i => i.name === name).pop();
            if (it) owner[key] = 'u:' + it.id;
            draft = null;
            app.persist();
            refresh();
            app.status.finish('ok', _T('Style « ') + name + _T(' » enregistré'), _T('Dans Mes effets : exportable et partageable.'));
          });
          const mine = cur.indexOf('u:') === 0 ? app.S.lib.items.find(i => 'u:' + i.id === cur) : null;
          const update = mine ? h('button', { class: 'action' }, _T('Mettre à jour « ') + mine.name + _T(' »')) : null;
          if (update) update.addEventListener('click', () => { mine.data.style = C.normStyle(d); draft = null; app.persist(); refresh(); });
          box.appendChild(h('div', { class: 'row-buttons' }, saveNew, update));
          box.appendChild(h('div', { class: 'note' }, _T('Police, taille et majuscules : si le modèle .mogrt les laisse modifier. Couleur et ombre : par ses réglages, sinon par les effets Teinte et Ombre portée. Contour et fond : seulement si le modèle les propose.')));
        }
      };
      refresh();
      return section(title || _T('Style du texte'), [box]);
    }

    // ---------------------------------------------------------------- bibliothèque

    app.itemTypes.textStyle = {
      icon: 'Aa', label: _T('Style de texte'), valid: d => !!d.style && typeof d.style === 'object',
      meta: it => { const s = C.normStyle(it.data.style); return [s.font || _T('police du modèle'), s.fill].join(' · '); },
      open: it => { const t = app.settings().titles || (app.settings().titles = {}); t.style = 'u:' + it.id; app.persist(); app.switchTab('titles'); }
    };
    app.itemTypes.palette = {
      icon: '🎨', label: 'Palette', valid: d => Array.isArray(d.colors) && d.colors.some(c => C.hex(c)),
      meta: it => app.plural(it.data.colors.length, _T('couleur')),
      open: it => { const n = addColors(it.data.colors); app.status.finish('ok', _T('Palette « ') + it.name + _T(' »'), n ? app.plural(n, _T('couleur ajoutée'), _T('couleurs ajoutées')) + _T(' à Mes couleurs.') : _T('Déjà dans Mes couleurs.')); }
    };
    app.importers.push({ exts: ['ase'], label: 'nuanciers', run: importAse });

    app.textStyles = { section: styleSection, colorsSection, options, styleById, styleFx, colorPick, myColors, addColors, paint };
    app.services.colorPick = colorPick;
  });
})(typeof self !== 'undefined' ? self : this);
