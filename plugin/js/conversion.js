/* RR FX : conversion LOG → Rec.709 en un clic (onglet Couleur).
   On enregistre une fois sa caméra et sa LUT de conversion (celle du fabricant, gardée dans
   Documents/RRFX/Conversion pour tous les projets, ou une LUT calculée par RR FX). Ensuite, un
   clic pose un calque de réglage Lumetri juste au-dessus des rushs, de la longueur de la
   timeline, avec la LUT chargée en « LUT d'entrée ». */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const L = root.RRFXLog, D = root.RRFXDevelop, A = root.RRFXAssets, Cam = root.RRFXCam, { Store, Host } = app;
    const { h, actionGroup, picker, row, checkbox } = app.UI;

    const EVS = [-2, -1, -0.5, 0, 0.5, 1, 1.5, 1.7, 2, 2.5, 3];
    const st = () => {
      const s = app.settings();
      if (!s.logconv || typeof s.logconv !== 'object') s.logconv = {};
      const c = s.logconv;
      if (!Array.isArray(c.cams)) c.cams = [];
      if (!c.scope) c.scope = 'sequence';
      if (!c.mode) c.mode = 'one';
      if (!c.unknown) c.unknown = 'active';
      if (!c.cams.some(x => x.id === c.active)) c.active = c.cams.length ? c.cams[0].id : null;
      return c;
    };
    const active = () => { const c = st(); return c.cams.find(x => x.id === c.active) || null; };
    const label = cam => L.camLabel(cam) || 'Ma caméra';
    const slug = s => A.fileSlug(s, 'camera');
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

    // La LUT à poser : celle du fabricant, ou la LUT calculée. Son nom porte l'empreinte du
    // contenu : un calque déjà posé garde sa LUT si le calcul ou les réglages changent.
    function lutFor(cam) {
      if (!Store.fs) return '';
      if (cam.mode !== 'calc') {
        if (!cam.lut || !Store.fs.existsSync(cam.lut)) throw new Error('LUT de ' + label(cam) + ' introuvable' + (cam.lut ? ' (' + cam.lut + ')' : '') + ' : réimporte-la dans l\'onglet Couleur.');
        return cam.lut;
      }
      const cube = D.toCube(L.buildLut(cam.profile, { size: 33, ev: cam.ev, contrast: cam.contrast }), label(cam) + ' vers Rec.709');
      const file = Store.path.join(dir(), 'RRFX ' + slug(label(cam)) + ' vers Rec709 ' + A.hashText(cube) + '.cube');
      if (!Store.fs.existsSync(file)) {
        Store.fs.mkdirSync(dir(), { recursive: true });
        Store.fs.writeFileSync(file, cube, 'utf8');
      }
      return file;
    }

    // Pour l'aperçu de l'onglet Couleur : la LUT de conversion de la caméra active.
    const previewCache = { key: '', lut: null };
    function previewLut() {
      const cam = active();
      if (!cam || !st().preview) return null;
      const key = JSON.stringify([cam.id, cam.mode, cam.profile, cam.ev, cam.contrast, cam.lut, cam.lutName, cam.lutStamp]);
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

    // ---------------------------------------------------------------- caméra de chaque rush

    // Début et fin du fichier (les métadonnées y sont) et le XML Sony posé à côté, s'il existe.
    const detected = new Map();
    function detectCam(path, name) {
      const key = path || name;
      if (detected.has(key)) return detected.get(key);
      let text = '';
      if (path && Store.fs) {
        try {
          const fd = Store.fs.openSync(path, 'r'), size = Store.fs.fstatSync(fd).size, HEAD = 1 << 20, TAIL = 4 << 20;
          const read = (pos, len) => { const b = Buffer.alloc(len); Store.fs.readSync(fd, b, 0, len, pos); return b.toString('latin1'); };
          text = size <= HEAD + TAIL ? read(0, size) : read(0, HEAD) + read(size - TAIL, TAIL);
          Store.fs.closeSync(fd);
          const xml = path.replace(/\.[^.\\/]+$/, '') + 'M01.XML';
          if (Store.fs.existsSync(xml)) text += Store.fs.readFileSync(xml, 'latin1');
        } catch (e) { app.log('Caméra de « ' + name + ' » illisible : ' + app.errorMessage(e), 'warn'); }
      }
      const det = Cam.detect(text, name || path);
      detected.set(key, det);
      return det;
    }

    /* Range les rushs par caméra enregistrée. → { groups: [{ cam, clips }], unknown, notLog } */
    function sortByCamera(clips) {
      const c = st(), groups = new Map(), unknown = [], notLog = [], fallback = c.unknown === 'skip' ? null : active();
      clips.forEach(clip => {
        const det = detectCam(clip.path, clip.name);
        if (det.log === false) { notLog.push(clip); return; }
        let cam = Cam.match(det, c.cams, c.active);
        if (!cam) { unknown.push(clip); cam = fallback; }
        if (!cam) return;
        if (!groups.has(cam.id)) groups.set(cam.id, { cam, clips: [] });
        groups.get(cam.id).clips.push(clip);
      });
      return { groups: Array.from(groups.values()), unknown, notLog };
    }

    // ---------------------------------------------------------------- un clic

    function lutResult(res, files) {
      if (!files.some(Boolean)) return 'Mode démo : dans Premiere, le calque Lumetri est posé au-dessus des rushs avec la LUT chargée.';
      if (res.lutSet >= res.layers) return 'LUT chargée dans Lumetri (LUT d\'entrée).';
      return 'Lumetri > Correction de base > LUT d\'entrée > Parcourir… et choisis « ' + files.filter(Boolean).map(f => Store.path.basename(f)).join(' », « ') + ' ».';
    }

    async function convertOne(cam) {
      const c = st(), name = 'RR FX · Conversion ' + label(cam);
      app.status.phase('LUT de conversion');
      const file = lutFor(cam);
      app.status.phase('Calque au-dessus des rushs');
      const fx = await app.services.lumetriFx();
      const res = await Host.call('logConvert', { name, lutPath: file, fxNames: fx[0].names, scope: c.scope, adjNodeId: app.settings().adjNodeId });
      if (!res.ok) throw new Error(res.error);
      if (file && !res.lutSet && navigator.clipboard) await navigator.clipboard.writeText(file).catch(() => {});
      return { res, title: 'Rec.709 · ' + label(cam), detail: app.plural(res.layers, 'calque Lumetri', 'calques Lumetri') + ' au-dessus des rushs. ' + lutResult(res, [file]) };
    }

    async function convertEach() {
      const c = st();
      app.status.phase('Rushs de la timeline');
      const list = await Host.call('rushList', { scope: c.scope });
      if (!list.ok) throw new Error(list.error);
      app.status.phase('Caméra de chaque plan');
      const sorted = sortByCamera(list.clips);
      if (!sorted.groups.length) throw new Error(sorted.notLog.length ? 'Aucun plan en LOG.' : 'Aucun plan ne correspond à une caméra enregistrée (marques reconnues : ' + c.cams.map(label).join(', ') + ').');
      const files = [], groups = sorted.groups.map(g => {
        const file = lutFor(g.cam);
        files.push(file);
        return { name: 'RR FX · Conversion ' + label(g.cam), lutPath: file, spans: g.clips.map(x => ({ a: x.start, b: x.end, top: x.track })) };
      });
      app.status.phase('Calques au-dessus des rushs');
      const fx = await app.services.lumetriFx();
      const res = await Host.call('placeGrades', { layer: 'conversion', groups, fxNames: fx[0].names, adjNodeId: app.settings().adjNodeId });
      if (!res.ok) throw new Error(res.error);
      sorted.groups.forEach(g => app.log(label(g.cam) + ' : ' + app.plural(g.clips.length, 'plan'), 'info'));
      if (sorted.unknown.length) app.log(app.plural(sorted.unknown.length, 'plan non reconnu', 'plans non reconnus') + (c.unknown === 'skip' ? ', laissés tels quels' : ', convertis avec ' + label(active())) + ' : ' + sorted.unknown.map(x => x.name).slice(0, 8).join(', '), 'warn');
      if (sorted.notLog.length) app.log(app.plural(sorted.notLog.length, 'plan', 'plans') + ' pas en LOG (Rec.709, HLG…), laissés tels quels : ' + sorted.notLog.map(x => x.name).slice(0, 8).join(', '), 'info');
      const parts = sorted.groups.map(g => label(g.cam) + ' (' + g.clips.length + ')');
      return {
        res, title: 'Rec.709 · ' + app.plural(sorted.groups.length, 'caméra', 'caméras'),
        detail: parts.join(', ') + (sorted.unknown.length ? ' · ' + app.plural(sorted.unknown.length, 'non reconnu', 'non reconnus') : '') + (sorted.notLog.length ? ' · ' + sorted.notLog.length + ' pas en LOG' : '') + '. ' + lutResult(res, files)
      };
    }

    function convert() {
      const cam = active(), c = st();
      if (!cam) {
        app.switchTab('color');
        return app.status.finish('warn', 'Aucune caméra enregistrée', 'Onglet Couleur > Conversion LOG → Rec.709 : choisis ta caméra et sa LUT, une seule fois.');
      }
      return app.runTask(c.mode === 'auto' ? 'Rec.709 par caméra' : 'Rec.709 · ' + label(cam), async () => {
        const out = c.mode === 'auto' ? await convertEach() : await convertOne(cam);
        const res = out.res, entries = (res.created || []).slice();
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        let detail = out.detail + (res.replaced ? ' L\'ancienne conversion a été remplacée.' : '');
        // Option : expo et balance des blancs de chaque plan, juste après la conversion.
        if (c.autoFix && app.correction) {
          const fix = await app.correction.autoFixCore(c.scope);
          entries.push.apply(entries, fix.created);
          detail += ' · Expo et balance : ' + fix.summary;
        }
        if (entries.length) app.pushHistory({ date: Date.now(), label: out.title, entries });
        const missing = Store.fs && res.lutSet < res.layers;
        return { kind: (res.warnings && res.warnings.length) || missing ? 'warn' : 'ok', title: out.title, detail };
      });
    }
    app.actions.convert = convert;

    // ---------------------------------------------------------------- panneau

    let edit = null; // caméra en cours d'ajout ou de modification

    function newCam() {
      return { id: app.uid(), brand: 'sony', model: '', profile: 'slog3-sg3c', mode: 'lut', lut: '', lutName: '', ev: 0, contrast: 'standard' };
    }

    function importLut(cam, refresh) {
      const done = (path, name) => { cam.lut = path; cam.lutName = name; cam.lutStamp = Date.now(); refresh(); };
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
          box.appendChild(row('Caméra', actionGroup([{ v: 'one', label: 'Celle cochée' }, { v: 'auto', label: 'Reconnue par plan', title: 'RR FX lit la marque et le modèle dans chaque fichier et prend la bonne LUT (les plans Sony filmés hors LOG sont laissés tels quels)' }], c.mode, v => { c.mode = v; app.persist(); refresh(); })));
          box.appendChild(row('Sur', actionGroup([{ v: 'sequence', label: 'Toute la timeline' }, { v: 'selection', label: 'Rushs choisis' }], c.scope, v => { c.scope = v; app.persist(); })));
          if (c.mode === 'auto') box.appendChild(row('Inconnus', picker([{ v: 'active', label: 'Convertis avec ' + label(cam) }, { v: 'skip', label: 'Laissés tels quels' }], c.unknown, v => { c.unknown = v; app.persist(); }), { title: 'Plans dont la caméra n\'est pas reconnue' }));
          box.appendChild(checkbox('Puis expo et balance des blancs auto sur chaque plan', c.autoFix, v => { c.autoFix = v; app.persist(); }));
          box.appendChild(checkbox('Aperçu en LOG (converti avant le look)', c.preview, v => { c.preview = v; app.persist(); onPreview(); }));
          const go = h('button', { class: 'cta conv-go' }, c.mode === 'auto' ? 'Convertir chaque plan avec sa caméra' : 'Convertir en Rec.709 · ' + label(cam));
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
