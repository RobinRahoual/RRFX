/* RR FX : correction des plans (onglet Couleur). Exposition et balance des blancs auto de
   chaque plan, et raccord d'une caméra sur une autre à partir d'une image de référence.
   RR FX exporte des images « propres » de la timeline (sans looks ni titres), les analyse,
   fabrique une LUT par plan (ou une pour le raccord) et la charge dans un calque Lumetri posé
   juste au-dessus de la conversion LOG, sous les looks. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const G = root.RRFXAuto, D = root.RRFXDevelop, A = root.RRFXAssets, { Store, Host } = app;
    const { h, actionGroup, row, checkbox } = app.UI;
    const TICKS = 254016000000;
    const STRENGTHS = [{ v: 40, label: 'Légère' }, { v: 70, label: 'Normale' }, { v: 100, label: 'Forte' }];

    const st = () => {
      const s = app.settings();
      if (!s.correction || typeof s.correction !== 'object') s.correction = {};
      const c = s.correction;
      c.fix = Object.assign({ exposure: true, wb: true, levels: true, strength: 70, scope: 'selection' }, c.fix);
      c.match = Object.assign({ strength: 70, ref: null, refName: '', refThumb: '' }, c.match);
      return c;
    };

    // .cube rangé dans Documents/RRFX/<dossier>, nommé d'après son contenu.
    function writeLut(folder, label, lut) {
      if (!Store.fs) return '';
      const cube = D.toCube(lut, label), dir = Store.path.join(Store.dir, folder);
      const file = Store.path.join(dir, 'RRFX ' + A.fileSlug(label, 'LUT', 40) + ' ' + A.hashText(cube) + '.cube');
      if (!Store.fs.existsSync(file)) { Store.fs.mkdirSync(dir, { recursive: true }); Store.fs.writeFileSync(file, cube, 'utf8'); }
      return file;
    }

    async function clipsOf(scope) {
      const list = await Host.call('rushList', { scope });
      if (!list.ok) throw new Error(list.error);
      // Les copies RR FX du plan (rampes…) suivent leur plan d'origine.
      const clips = list.clips.filter(c => !c.copy);
      if (!clips.length) throw new Error('Aucun rush à corriger.');
      return clips;
    }

    const progress = (label, n) => p => app.status.progress(Math.round(p * n), n, label);

    // ---------------------------------------------------------------- expo et balance auto

    /* Sans tâche propre : appelée aussi par la conversion LOG. → { created, summary, layers } */
    async function autoFixCore(scope) {
      const f = st().fix, clips = await clipsOf(scope);
      app.status.phase('Images de ' + app.plural(clips.length, 'plan'));
      const frames = await app.services.grabClean(clips.map(c => (c.start + c.end) / 2 / TICKS), 2, 320, progress('Export des images', clips.length));
      app.status.phase('Analyse');
      const groups = [];
      let evSum = 0, done = 0;
      clips.forEach((clip, i) => {
        const p = G.autoParams(G.analyze(frames[i].data), { exposure: f.exposure, wb: f.wb, levels: f.levels, strength: f.strength / 100 });
        const what = G.describe(p);
        if (what === 'déjà juste') return;
        app.log(clip.name + ' : ' + what, 'info');
        evSum += p.ev; done++;
        groups.push({ name: 'RR FX · Auto ' + clip.name, lutPath: writeLut('Auto', 'Auto ' + clip.name, G.lutOf(G.correction(p), 33)), spans: [{ a: clip.start, b: clip.end, top: clip.track }] });
      });
      if (!groups.length) return { created: [], layers: 0, summary: 'tous les plans sont déjà justes' };
      app.status.phase('Calques au-dessus de la conversion');
      const fx = await app.services.lumetriFx();
      const res = await Host.call('placeGrades', { layer: 'auto', groups, fxNames: fx[0].names, adjNodeId: app.settings().adjNodeId });
      if (!res.ok) throw new Error(res.error);
      (res.warnings || []).forEach(w => app.log(w, 'warn'));
      const ev = evSum / done;
      return { created: res.created, layers: res.layers, summary: app.plural(done, 'plan corrigé', 'plans corrigés') + ' sur ' + clips.length + (Math.abs(ev) >= 0.05 ? ' (exposition moyenne ' + (ev > 0 ? '+' : '') + ev.toFixed(1).replace('.', ',') + ' IL)' : '') };
    }

    function autoFix() {
      return app.runTask('Expo et balance auto', async () => {
        const out = await autoFixCore(st().fix.scope);
        if (out.created.length) app.pushHistory({ date: Date.now(), label: 'Expo et balance auto', entries: out.created });
        return { kind: 'ok', title: 'Expo et balance auto', detail: out.summary[0].toUpperCase() + out.summary.slice(1) + '. Un calque Lumetri par plan, juste au-dessus de la conversion.' };
      });
    }

    // ---------------------------------------------------------------- raccord entre caméras

    const thumbOf = img => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = Math.round(160 * img.height / img.width);
      const t = document.createElement('canvas');
      t.width = img.width; t.height = img.height;
      t.getContext('2d').putImageData(img, 0, 0);
      c.getContext('2d').drawImage(t, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    };
    // Statistiques gardées dans les réglages (histogramme en tableau simple).
    const pack = s => Object.assign({}, s, { hist: Array.from(s.hist, v => Math.round(v * 1e6) / 1e6) });

    let lastPreview = null; // { before, after } du dernier raccord, pour l'aperçu

    function captureRef(refresh) {
      return app.runTask('Référence du raccord', async () => {
        const m = await Host.call('markerList', {});
        const t = m.ok ? m.playhead : 0;
        const ctx = await Host.call('getContext', {});
        const [img] = await app.services.grabClean([t], 3, 320);
        const c = st().match;
        c.ref = pack(G.analyze(img.data));
        c.refName = (ctx.ok && ctx.selectionNames && ctx.selectionNames[0]) || 'image à ' + t.toFixed(1).replace('.', ',') + ' s';
        c.refThumb = thumbOf(img);
        app.persist();
        refresh();
        return { kind: 'ok', title: 'Référence prise', detail: 'Sélectionne maintenant les plans de l\'autre caméra, puis « Raccorder la sélection ».' };
      });
    }

    function matchSelection(refresh) {
      const c = st().match;
      if (!c.ref) return app.status.finish('warn', 'Pas de référence', 'Place la tête de lecture sur un plan de la caméra de référence, puis « Prendre la référence ».');
      return app.runTask('Raccord', async () => {
        const clips = await clipsOf('selection');
        // Jusqu'à 8 images réparties sur les plans choisis.
        const pick = clips.length <= 8 ? clips : Array.from({ length: 8 }, (_, i) => clips[Math.round(i * (clips.length - 1) / 7)]);
        app.status.phase('Images des plans à raccorder');
        const frames = await app.services.grabClean(pick.map(x => (x.start + x.end) / 2 / TICKS), 3, 320, progress('Export des images', pick.length));
        const ref = Object.assign({}, c.ref, { hist: Float64Array.from(c.ref.hist) });
        const p = G.matchParams(G.merge(frames.map(f => G.analyze(f.data))), ref, c.strength / 100), fn = G.matcher(p);
        const after = new ImageData(new Uint8ClampedArray(frames[0].data), frames[0].width, frames[0].height);
        A.applyLut(after.data, G.lutOf(fn, 17));
        lastPreview = { before: frames[0], after };
        const name = 'RR FX · Raccord sur ' + c.refName;
        const fx = await app.services.lumetriFx();
        const res = await Host.call('placeGrades', { layer: 'match', groups: [{ name, lutPath: writeLut('Raccord', 'Raccord ' + c.refName, G.lutOf(fn, 33)), spans: clips.map(x => ({ a: x.start, b: x.end, top: x.track })) }], fxNames: fx[0].names, adjNodeId: app.settings().adjNodeId });
        if (!res.ok) return { kind: 'error', title: 'Raccord non posé', detail: res.error };
        if (res.created.length) app.pushHistory({ date: Date.now(), label: 'Raccord', entries: res.created });
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        refresh();
        return { kind: res.warnings && res.warnings.length ? 'warn' : 'ok', title: 'Raccord posé · ' + app.plural(clips.length, 'plan'), detail: 'Calé sur « ' + c.refName + ' ». Ajuste la force et relance si besoin : le raccord est remplacé.' };
      });
    }

    // ---------------------------------------------------------------- panneau

    function strengthPicker(obj) {
      return actionGroup(STRENGTHS, obj.strength, v => { obj.strength = v; app.persist(); });
    }

    function panel(makePanel) {
      const box = h('div');
      const refresh = () => {
        box.innerHTML = '';
        const c = st(), f = c.fix, m = c.match;
        const btn = (label, fn, cls) => { const b = h('button', { class: 'action' + (cls ? ' ' + cls : '') }, label); b.addEventListener('click', fn); return b; };
        box.appendChild(h('div', { class: 'lr-sub' }, 'Expo et balance des blancs auto'));
        box.appendChild(h('div', { class: 'note' }, 'Chaque plan est analysé (image du milieu, après la conversion LOG) et corrigé avec mesure : un plan sombre voulu reste sombre.'));
        box.appendChild(h('div', { class: 'row-buttons wrap' },
          checkbox('Exposition', f.exposure, v => { f.exposure = v; app.persist(); }),
          checkbox('Balance des blancs', f.wb, v => { f.wb = v; app.persist(); }),
          checkbox('Noirs et blancs', f.levels, v => { f.levels = v; app.persist(); })));
        box.appendChild(row('Force', strengthPicker(f)));
        box.appendChild(row('Sur', actionGroup([{ v: 'selection', label: 'Rushs choisis' }, { v: 'sequence', label: 'Toute la timeline' }], f.scope, v => { f.scope = v; app.persist(); })));
        box.appendChild(h('div', { class: 'row-buttons' }, btn('Corriger les plans', autoFix, 'selected')));

        box.appendChild(h('div', { class: 'lr-sub' }, 'Raccord entre caméras'));
        box.appendChild(h('div', { class: 'note' }, '1. Tête de lecture sur un plan de la caméra qui a le bon rendu. 2. Sélectionne les plans de l\'autre caméra. Le raccord se pose au-dessus de la conversion et de l\'expo auto.'));
        const refBox = h('div', { class: 'fix-ref' },
          m.refThumb ? h('img', { src: m.refThumb, alt: '' }) : h('div', { class: 'fix-empty' }, 'Pas encore de référence'),
          h('div', { class: 'fix-ref-txt' }, m.ref ? h('div', { class: 'conv-name' }, 'Référence : ' + m.refName) : null, btn(m.ref ? 'Reprendre la référence' : '1. Prendre la référence', () => captureRef(refresh))));
        box.appendChild(refBox);
        box.appendChild(row('Force', strengthPicker(m)));
        box.appendChild(h('div', { class: 'row-buttons' }, btn('2. Raccorder la sélection', () => matchSelection(refresh), m.ref ? 'selected' : '')));
        if (lastPreview) {
          const pair = h('div', { class: 'fix-preview' });
          [['Avant', lastPreview.before], ['Après', lastPreview.after]].forEach(([t, img]) => {
            const cv = h('canvas', { width: img.width, height: img.height });
            cv.getContext('2d').putImageData(img, 0, 0);
            pair.appendChild(h('figure', null, cv, h('figcaption', null, t)));
          });
          box.appendChild(pair);
        }
      };
      refresh();
      return makePanel('fix', 'Expo, balance et raccord', [box]);
    }

    app.correction = { panel, autoFix, autoFixCore };
    app.actions.autoFix = autoFix;
  });
})(typeof self !== 'undefined' ? self : this);
