/* RR FX — conversion LOG → Rec.709 en un clic (onglet Couleur).
   On enregistre une fois sa caméra et sa LUT de conversion (celle du fabricant, gardée dans
   Documents/RRFX/Conversion pour tous les projets, ou une LUT calculée par RR FX). Ensuite, un
   clic pose un calque de réglage Lumetri juste au-dessus des rushs, de la longueur de la
   timeline, avec la LUT chargée en « LUT d'entrée ». */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const L = root.RRFXLog, D = root.RRFXDevelop, A = root.RRFXAssets, { Store, Host } = app;
    const { h, actionGroup, picker, row, checkbox } = app.UI;

    const EVS = [-2, -1, -0.5, 0, 0.5, 1, 1.5, 1.7, 2, 2.5, 3];
    const st = () => {
      const s = app.settings();
      if (!s.logconv || typeof s.logconv !== 'object') s.logconv = {};
      const c = s.logconv;
      if (!Array.isArray(c.cams)) c.cams = [];
      if (!c.scope) c.scope = 'sequence';
      if (!c.cams.some(x => x.id === c.active)) c.active = c.cams.length ? c.cams[0].id : null;
      return c;
    };
    const active = () => { const c = st(); return c.cams.find(x => x.id === c.active) || null; };
    const label = cam => L.camLabel(cam) || 'Ma caméra';
    const slug = s => String(s || 'camera').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\- .]+/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'camera';
    const evText = ev => (ev > 0 ? '+' : '') + String(ev).replace('.', ',') + ' IL';
    const dir = () => Store.path.join(Store.dir, 'Conversion');
    const demoLuts = new Map(); // mode démo : LUT importées gardées en mémoire (pas de disque)

    function lutInfo(cam) {
      if (cam.mode === 'calc') return 'LUT calculée par RR FX · ' + (L.CONTRASTS[cam.contrast] || L.CONTRASTS.standard).label + (cam.ev ? ' · tourné à ' + evText(cam.ev) : '');
      return cam.lutName ? 'LUT : ' + cam.lutName : 'LUT à importer';
    }

    // ---------------------------------------------------------------- LUT sur le disque

    // Valide un .cube et le range dans Documents/RRFX/Conversion (et le dossier « Technical »
    // d'Adobe, où Lumetri liste ses LUT d'entrée) : il sert à tous les projets.
    function storeLut(cam, file) {
      const text = Store.fs.readFileSync(file, 'utf8'), lut = A.parseCube(text);
      if (!lut.size || !lut.data) throw new Error('« ' + Store.path.basename(file) + ' » n\'est pas une LUT .cube lisible.');
      Store.fs.mkdirSync(dir(), { recursive: true });
      const out = Store.path.join(dir(), slug(label(cam)) + ' - ' + Store.path.basename(file).replace(/\.cube$/i, '') + '.cube');
      if (Store.path.resolve(out) !== Store.path.resolve(file)) Store.fs.copyFileSync(file, out);
      try {
        const tech = Store.path.join(Store.path.dirname(Store.systemDirs().luts), 'Technical');
        Store.fs.mkdirSync(tech, { recursive: true });
        Store.fs.copyFileSync(out, Store.path.join(tech, Store.path.basename(out)));
      } catch (e) { app.log('LUT non copiée dans le dossier Adobe : ' + app.errorMessage(e), 'warn'); }
      return { path: out, name: Store.path.basename(file) };
    }

    // La LUT à poser : celle du fabricant, ou la LUT calculée (écrite une fois par réglage).
    function lutFor(cam) {
      if (!Store.fs) return '';
      if (cam.mode !== 'calc') {
        if (!cam.lut || !Store.fs.existsSync(cam.lut)) throw new Error('LUT de ' + label(cam) + ' introuvable' + (cam.lut ? ' (' + cam.lut + ')' : '') + ' : réimporte-la dans l\'onglet Couleur.');
        return cam.lut;
      }
      const name = 'RRFX ' + slug(label(cam)) + ' vers Rec709' + (cam.ev ? ' ' + String(cam.ev).replace('.', ',') + 'EV' : '') + (cam.contrast && cam.contrast !== 'standard' ? ' ' + cam.contrast : '') + '.cube';
      const file = Store.path.join(dir(), name);
      if (!Store.fs.existsSync(file)) {
        Store.fs.mkdirSync(dir(), { recursive: true });
        Store.fs.writeFileSync(file, D.toCube(L.buildLut(cam.profile, { size: 33, ev: cam.ev, contrast: cam.contrast }), label(cam) + ' vers Rec.709'), 'utf8');
      }
      return file;
    }

    // Pour l'aperçu de l'onglet Couleur : la LUT de conversion de la caméra active.
    const previewCache = { key: '', lut: null };
    function previewLut() {
      const cam = active();
      if (!cam || !st().preview) return null;
      const key = JSON.stringify([cam.id, cam.mode, cam.profile, cam.ev, cam.contrast, cam.lut, cam.lutName]);
      if (previewCache.key === key) return previewCache.lut;
      let lut = null;
      try {
        if (cam.mode === 'calc') lut = L.buildLut(cam.profile, { size: 33, ev: cam.ev, contrast: cam.contrast });
        else if (demoLuts.has(cam.id)) lut = A.parseCube(demoLuts.get(cam.id));
        else if (cam.lut && Store.fs && Store.fs.existsSync(cam.lut)) lut = A.parseCube(Store.fs.readFileSync(cam.lut, 'utf8'));
      } catch (e) { lut = null; }
      if (lut && !lut.size) lut = null;
      previewCache.key = key;
      previewCache.lut = lut;
      return lut;
    }

    // ---------------------------------------------------------------- un clic

    async function lumetriName() {
      const r = await Host.call('listEffects', { filter: 'lumetri' });
      return (r.ok && r.names.find(n => /lumetri/i.test(n) && !/preset|préréglage/i.test(n))) || null;
    }

    function convert() {
      const cam = active();
      if (!cam) {
        app.switchTab('color');
        return app.status.finish('warn', 'Aucune caméra enregistrée', 'Onglet Couleur > Conversion LOG → Rec.709 : choisis ta caméra et sa LUT, une seule fois.');
      }
      const c = st(), name = 'RR FX · Conversion ' + label(cam);
      return app.runTask('Rec.709 · ' + label(cam), async () => {
        app.status.phase('LUT de conversion');
        const file = lutFor(cam);
        app.status.phase('Calque au-dessus des rushs');
        const found = await lumetriName();
        const res = await Host.call('logConvert', { name, lutPath: file, fxNames: (found ? [found] : []).concat(A.LUMETRI_NAMES), scope: c.scope, adjNodeId: app.settings().adjNodeId });
        if (!res.ok) return { kind: 'error', title: 'Conversion non posée', detail: res.error };
        if (res.created && res.created.length) app.pushHistory({ date: Date.now(), label: 'Rec.709 · ' + label(cam), entries: res.created });
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        const replaced = res.replaced ? ' L\'ancienne conversion a été remplacée.' : '';
        if (!file) return { kind: 'ok', title: 'Rec.709 · ' + label(cam), detail: 'Mode démo : dans Premiere, le calque Lumetri est posé au-dessus des rushs avec la LUT chargée.' };
        if (res.lutSet) {
          return {
            kind: res.warnings && res.warnings.length ? 'warn' : 'ok',
            title: 'Rec.709 · ' + label(cam),
            detail: app.plural(res.layers, 'calque Lumetri', 'calques Lumetri') + ' au-dessus des rushs, LUT « ' + Store.path.basename(file) + ' » chargée.' + replaced + ' Pose ton look au-dessus.'
          };
        }
        const copied = navigator.clipboard ? await navigator.clipboard.writeText(file).then(() => true, () => false) : false;
        return {
          kind: 'warn',
          title: 'Calque posé · LUT à choisir',
          detail: 'Lumetri > Correction de base > LUT d\'entrée > Parcourir… et choisis « ' + Store.path.basename(file) + ' »' + (copied ? ' (chemin copié)' : '') + '.' + replaced
        };
      });
    }
    app.actions.convert = convert;

    // ---------------------------------------------------------------- panneau

    let edit = null; // caméra en cours d'ajout ou de modification

    function newCam() {
      return { id: app.uid(), brand: 'sony', model: '', profile: 'slog3-sg3c', mode: 'lut', lut: '', lutName: '', ev: 0, contrast: 'standard' };
    }

    function importLut(cam, refresh) {
      const done = (path, name) => { cam.lut = path; cam.lutName = name; refresh(); };
      const files = Store.pickFiles('LUT de conversion vers Rec.709 (.cube)', ['cube']);
      if (files === null) {
        // Hors de Premiere : lecture dans le navigateur (aperçu seulement).
        const input = h('input', { type: 'file', accept: '.cube', style: { display: 'none' } });
        input.addEventListener('change', () => {
          const f = input.files && input.files[0];
          if (!f) return;
          f.text().then(text => {
            const lut = A.parseCube(text);
            if (!lut.size) return app.status.finish('error', 'LUT illisible', f.name + ' n\'est pas une LUT .cube.');
            demoLuts.set(cam.id, text);
            done('', f.name);
          });
        });
        document.body.appendChild(input);
        input.click();
        setTimeout(() => input.remove(), 60000);
        return;
      }
      if (!files.length) return;
      try {
        const r = storeLut(cam, files[0]);
        done(r.path, r.name);
        app.log('LUT de conversion gardée : ' + r.path, 'ok');
      } catch (e) { app.status.finish('error', 'LUT non importée', app.errorMessage(e)); }
    }

    function form(refresh) {
      const cam = edit, b = L.brand(cam.brand);
      if (!b.profiles.includes(cam.profile)) cam.profile = b.profiles[0];
      if (cam.mode === 'calc' && !L.canCompute(cam.profile)) cam.mode = 'lut';
      const models = h('datalist', { id: 'conv-models' }, b.models.map(m => h('option', { value: m })));
      const model = h('input', { class: 'textfield', value: cam.model, list: 'conv-models', placeholder: b.models[0] ? 'ex. ' + b.models[0] : 'Nom de la caméra' });
      model.addEventListener('input', () => { cam.model = model.value.trim(); });
      const save = h('button', { class: 'action selected', disabled: cam.mode === 'lut' && !cam.lutName }, 'Enregistrer la caméra');
      save.addEventListener('click', () => {
        const c = st(), i = c.cams.findIndex(x => x.id === cam.id);
        if (i >= 0) c.cams[i] = cam; else c.cams.push(cam);
        c.active = cam.id;
        edit = null;
        app.persist();
        refresh(true);
        app.renderCTA();
        app.status.finish('ok', 'Caméra enregistrée : ' + label(cam), 'Pour tous tes projets : un clic sur « Convertir en Rec.709 » (raccourci ' + (app.S.shortcuts && app.S.shortcuts.convert || 'L') + ').');
      });
      const cancel = h('button', { class: 'action quiet' }, 'Annuler');
      cancel.addEventListener('click', () => { edit = null; refresh(); });
      const lutBox = [];
      if (cam.mode === 'lut') {
        const imp = h('button', { class: 'action' }, cam.lutName ? 'Changer la LUT…' : 'Importer la LUT .cube…');
        imp.addEventListener('click', () => importLut(cam, refresh));
        const find = h('button', { class: 'action quiet', title: 'Recherche de la LUT officielle de ta caméra' }, 'Trouver la LUT officielle ↗');
        find.addEventListener('click', () => Host.openURL(L.searchURL(cam)));
        lutBox.push(h('div', { class: 'row-buttons wrap' }, imp, find));
        lutBox.push(h('div', { class: 'note' + (cam.lutName ? '' : ' warn') }, cam.lutName ? '✓ ' + cam.lutName + (cam.lut ? ' · gardée dans Documents/RRFX/Conversion' : '') : 'La LUT « log vers 709 » du fabricant (.cube), à télécharger sur son site.'));
      } else {
        lutBox.push(row('Exposé à', picker(EVS.map(v => ({ v: String(v), label: v === 0 ? '0 IL (normal)' : evText(v) })), String(cam.ev || 0), v => { cam.ev = Number(v); }), { title: 'Si tu surexposes ton log au tournage (ex. S-Log3 à +1,7 IL), la LUT compense' }));
        lutBox.push(row('Rendu', actionGroup(Object.keys(L.CONTRASTS).map(k => ({ v: k, label: L.CONTRASTS[k].label })), cam.contrast || 'standard', v => { cam.contrast = v; })));
        lutBox.push(h('div', { class: 'note' }, 'Calculée d\'après les courbes publiées par ' + (b.id === 'other' ? 'le fabricant' : b.label) + ' (log → linéaire → gamut Rec.709, épaule douce sur les hautes lumières).'));
      }
      return h('div', { class: 'conv-form' },
        models,
        row('Marque', picker(L.BRANDS.map(x => ({ v: x.id, label: x.label })), cam.brand, v => { cam.brand = v; cam.model = ''; refresh(); })),
        row('Modèle', model),
        row('Profil', picker(b.profiles.map(id => ({ v: id, label: L.profile(id).label })), cam.profile, v => { cam.profile = v; refresh(); })),
        row('LUT', actionGroup([
          { v: 'lut', label: 'Du fabricant' },
          { v: 'calc', label: 'Calculée', disabled: !L.canCompute(cam.profile), title: L.canCompute(cam.profile) ? 'Sans fichier : RR FX la calcule' : 'Pas de formule publiée pour ce profil : prends la LUT du fabricant' }
        ], cam.mode, v => { cam.mode = v; refresh(); })),
        lutBox,
        h('div', { class: 'row-buttons' }, save, cancel));
    }

    function camRow(cam, refresh) {
      const c = st(), on = cam.id === c.active;
      const ed = h('button', { class: 'action quiet icon', title: 'Modifier' }, '✎');
      const del = h('button', { class: 'action quiet icon danger', title: 'Retirer' }, '✕');
      const el = h('div', { class: 'conv-cam' + (on ? ' on' : ''), title: on ? 'Caméra utilisée' : 'Utiliser cette caméra' },
        h('span', { class: 'conv-dot' }, on ? '●' : '○'),
        h('div', { class: 'conv-txt' }, h('div', { class: 'conv-name' }, label(cam) + ' · ' + (L.profile(cam.profile) || { label: '' }).label.split(' / ').slice(1).join(' / ')), h('div', { class: 'note' }, lutInfo(cam))),
        ed, del);
      el.addEventListener('click', e => {
        if (e.target === ed) { edit = JSON.parse(JSON.stringify(cam)); return refresh(); }
        if (e.target === del) {
          return app.confirmDialog('Retirer ' + label(cam) + ' ?', 'La LUT reste dans Documents/RRFX/Conversion.', 'Retirer').then(yes => {
            if (!yes) return;
            c.cams = c.cams.filter(x => x.id !== cam.id);
            app.persist(); refresh(true); app.renderCTA();
          });
        }
        c.active = cam.id;
        app.persist(); refresh(true); app.renderCTA();
      });
      return el;
    }

    /* Panneau « Conversion LOG → Rec.709 » ; panel(id, titre, contenu) vient de l'onglet Couleur,
       onPreview() redessine l'aperçu quand la conversion d'aperçu change. */
    function panel(makePanel, onPreview) {
      const box = h('div');
      const refresh = previewChanged => {
        box.innerHTML = '';
        const c = st(), cam = active();
        if (edit) { box.appendChild(form(refresh)); return; }
        if (!c.cams.length) {
          box.appendChild(h('div', { class: 'note' }, 'Tu filmes en LOG (S-Log3, V-Log, C-Log3, F-Log2, D-Log, Apple Log…) ? Enregistre ta caméra et sa LUT une fois : ensuite un clic passe la timeline en Rec.709, dans tous tes projets.'));
        }
        c.cams.forEach(x => box.appendChild(camRow(x, refresh)));
        const add = h('button', { class: 'action' }, '+ Ajouter une caméra');
        add.addEventListener('click', () => { edit = newCam(); refresh(); });
        box.appendChild(h('div', { class: 'row-buttons' }, add));
        if (cam) {
          box.appendChild(row('Sur', actionGroup([{ v: 'sequence', label: 'Toute la timeline' }, { v: 'selection', label: 'Rushs choisis' }], c.scope, v => { c.scope = v; app.persist(); })));
          box.appendChild(checkbox('Aperçu en LOG (converti avant le look)', c.preview, v => { c.preview = v; app.persist(); onPreview(); }));
          const go = h('button', { class: 'cta conv-go' }, 'Convertir en Rec.709 · ' + label(cam));
          go.addEventListener('click', convert);
          box.appendChild(go);
          box.appendChild(h('div', { class: 'note' }, 'Calque de réglage Lumetri juste au-dessus des rushs, sur toute leur longueur, LUT chargée en « LUT d\'entrée ». Les looks se posent au-dessus. Premiere 25 qui convertit déjà le log (Gestion des couleurs > Détection automatique du log) : coupe-la, sinon l\'image est convertie deux fois.'));
        }
        if (previewChanged) onPreview();
      };
      refresh();
      return makePanel('log', 'Conversion LOG → Rec.709', [box]);
    }

    app.conversion = { panel, convert, previewLut, active };
  });
})(typeof self !== 'undefined' ? self : this);
