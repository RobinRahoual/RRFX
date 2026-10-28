/* RR FX : packs de style dans « Mes effets ». Créer un pack (effets et rampes perso, looks,
   style des textes et son modèle .mogrt, overlays importés, enchaînement) et l'enregistrer en
   .rrfxpack ; importer un pack reçu : tout est ajouté en un clic, les fichiers rangés dans
   Documents/RRFX/Packs. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const P = root.RRFXStylePack, { Store } = app;
    const { h, checkbox, section } = app.UI;
    const TITLE_KEYS = ['anim', 'params', 'inF', 'outF', 'split', 'timing', 'gap', 'maxDur', 'fixed'];

    const readFile = p => { try { return Store.fs && p && Store.fs.existsSync(p) ? new Uint8Array(Store.fs.readFileSync(p)) : null; } catch (e) { return null; } };
    const titlesOf = () => { const t = app.settings().titles || {}; const out = {}; TITLE_KEYS.forEach(k => { if (k in t) out[k] = JSON.parse(JSON.stringify(t[k])); }); return out; };

    // ---------------------------------------------------------------- créer

    async function createPack() {
      const s = app.settings(), items = app.S.lib.items.filter(i => app.itemTypes[i.type]);
      const overlays = (s.overlays || []).filter(o => o.path && !o.pack);
      const chain = (s.chain && s.chain.keys) || [], color = s.color && s.color.params;
      const pick = { items: new Set(items.map(i => i.id)), look: !!color, titles: !!s.titles, overlays: overlays.length > 0 && !!Store.fs, chain: chain.length > 0 };
      const name = h('input', { class: 'textfield', value: 'Mon style', placeholder: 'Nom du pack' });
      const list = h('div', { class: 'pack-list' }, items.map(i => checkbox(i.name + ' · ' + app.itemTypes[i.type].label.toLowerCase(), true, v => { if (v) pick.items.add(i.id); else pick.items.delete(i.id); })));
      const body = h('div', null,
        name,
        h('div', { class: 'lr-sub' }, 'Contenu'),
        items.length ? list : h('div', { class: 'note' }, 'Aucun effet perso pour l\'instant.'),
        color ? checkbox('Look en cours de l\'onglet Couleur (« ' + (s.color.name || 'Mon look') + ' »)', pick.look, v => { pick.look = v; }) : null,
        s.titles ? checkbox('Style des textes (animation' + (s.titles.mogrt ? ' et modèle .mogrt' : '') + ')', pick.titles, v => { pick.titles = v; }) : null,
        overlays.length ? checkbox(app.plural(overlays.length, 'overlay importé', 'overlays importés') + ' (fichiers inclus)', pick.overlays, v => { pick.overlays = v; }) : null,
        chain.length ? checkbox('Enchaînement de ' + app.plural(chain.length, 'effet'), pick.chain, v => { pick.chain = v; }) : null);
      const ok = await app.modal('Créer un pack de style', body, [{ label: 'Annuler', value: false }, { label: 'Enregistrer le pack…', value: true, primary: true }]);
      if (!ok) return;
      return app.runTask('Pack de style', async () => {
        app.status.phase('Rassemblement');
        const chosen = items.filter(i => pick.items.has(i.id)), src = { name: name.value.trim() || 'Mon style', author: '', items: chosen };
        if (pick.look && color) src.look = { name: s.color.name || 'Mon look', params: JSON.parse(JSON.stringify(color)) };
        if (pick.titles) {
          src.titles = titlesOf();
          const m = readFile(s.titles.mogrt);
          if (m) src.mogrt = { file: Store.path.basename(s.titles.mogrt), data: m };
        }
        const missing = [];
        if (pick.overlays) src.overlays = overlays.map(o => ({ name: o.name, kind: o.kind, file: Store.path.basename(o.path), data: readFile(o.path) })).filter(o => o.data || (missing.push(o.name), false));
        if (pick.chain) {
          // Effets intégrés par leur nom interne, effets perso par leur place dans le pack.
          src.chain = chain.map(k => (k.startsWith('b:') ? { builtin: k.slice(2) } : k.startsWith('u:') ? { item: chosen.findIndex(i => 'u:' + i.id === k) } : null)).filter(x => x && (x.builtin || x.item >= 0));
        }
        app.status.phase('Écriture du pack');
        const out = Store.saveBinary(P.zipChunks(P.build(src), Store.zip && Store.zip.deflate), P.safeName(src.name) + '.rrfxpack', 'rrfxpack', 'Enregistrer le pack de style');
        if (!out) return { kind: 'warn', title: 'Pack non enregistré', detail: 'Enregistrement annulé.' };
        missing.forEach(n => app.log('Overlay introuvable sur le disque, pas inclus : ' + n, 'warn'));
        const m = { items: chosen, overlays: src.overlays || [], titles: src.titles, look: src.look, chain: src.chain };
        return { kind: missing.length ? 'warn' : 'ok', title: 'Pack « ' + src.name + ' » enregistré', detail: P.summary(m) + ' · ' + out + '. Envoie le fichier : « Importer un pack » l\'ajoute en un clic.' };
      });
    }

    // ---------------------------------------------------------------- importer

    function pickPack() {
      const files = Store.pickFiles('Importer un pack de style RR FX', ['rrfxpack', 'zip']);
      if (files !== null) return Promise.resolve(files.length ? { name: Store.path.basename(files[0]), bytes: new Uint8Array(Store.fs.readFileSync(files[0])) } : null);
      return new Promise(resolve => {
        const input = h('input', { type: 'file', accept: '.rrfxpack,.zip', class: 'hidden' });
        input.addEventListener('change', () => { const f = input.files[0]; if (!f) return resolve(null); f.arrayBuffer().then(b => resolve({ name: f.name, bytes: new Uint8Array(b) }), () => resolve(null)); });
        document.body.appendChild(input);
        input.click();
        setTimeout(() => input.remove(), 60000);
      });
    }

    async function importPack(given) {
      const got = given || await pickPack();
      if (!got) return;
      let pack;
      try { pack = P.read(got.bytes, Store.zip && Store.zip.inflate); } catch (e) { return app.status.finish('error', 'Pack illisible', got.name + ' : ' + app.errorMessage(e)); }
      const m = pack.manifest;
      const ok = await app.confirmDialog('Importer « ' + m.name + ' » ?', P.summary(m) + (m.titles ? '. Le style des textes remplace le tien.' : '.'), 'Importer');
      if (!ok) return;
      return app.runTask('Import du pack', async () => {
        const s = app.settings(), dir = Store.fs ? Store.path.join(Store.dir, 'Packs', P.safeName(m.name)) : null;
        const save = file => {
          const data = pack.files.get(file);
          if (dir) {
            const out = Store.path.join(dir, file);
            Store.fs.mkdirSync(Store.path.dirname(out), { recursive: true });
            Store.fs.writeFileSync(out, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
            return out;
          }
          const blob = new Blob([data]);
          return { name: Store.path ? Store.path.basename(file) : file.split('/').pop(), url: URL.createObjectURL(blob) };
        };
        // Effets, rampes et looks : à la suite de la bibliothèque (ids neufs).
        const before = new Set(app.S.lib.items.map(i => i.id));
        const items = m.items.slice();
        if (m.look) items.push({ type: 'look', name: m.look.name, data: { params: m.look.params } });
        if (items.length) app.services.addItems(items);
        const added = app.S.lib.items.filter(i => !before.has(i.id));
        if (m.overlays.length) app.services.addOverlays(m.overlays.map(o => save(o.file)));
        if (m.titles) {
          const t = s.titles || (s.titles = {});
          TITLE_KEYS.forEach(k => { if (k in m.titles) t[k] = m.titles[k]; });
          if (m.titles.mogrt && dir) t.mogrt = save(m.titles.mogrt);
        }
        if (m.chain && m.chain.length) {
          const keys = m.chain.map(c => (c.builtin ? 'b:' + c.builtin : c.item >= 0 && added[c.item] ? 'u:' + added[c.item].id : null)).filter(Boolean);
          if (keys.length) s.chain = { keys, order: (s.chain && s.chain.order) || 'cycle' };
        }
        app.persist();
        app.renderCTA();
        return { kind: 'ok', title: 'Pack « ' + m.name + ' » importé', detail: P.summary(m) + (dir ? ' · fichiers dans ' + dir : '') + '.' };
      });
    }

    app.stylePacks = {
      section: () => {
        const mk = h('button', { class: 'action' }, 'Créer un pack…');
        mk.addEventListener('click', createPack);
        const im = h('button', { class: 'action' }, 'Importer un pack…');
        im.addEventListener('click', () => importPack());
        return section('Packs de style', [
          h('div', { class: 'note' }, 'Tout ton style dans un fichier .rrfxpack : effets et rampes perso, looks, animation des textes et modèle .mogrt, overlays (fichiers compris), enchaînement. Partage-le ou garde-le pour d\'autres projets.'),
          h('div', { class: 'row-buttons' }, mk, im)
        ]);
      },
      importPack, createPack
    };
    // « Importer… » de Mes effets reconnaît aussi les packs.
    app.importers.push({ exts: ['rrfxpack', 'zip'], label: 'packs de style', run: async files => { for (const f of files) await importPack({ name: f.name, bytes: f.bytes }); return { n: 0, handled: true }; } });
  });
})(typeof self !== 'undefined' ? self : this);
