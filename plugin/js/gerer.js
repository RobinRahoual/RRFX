/* RR FX : gérer ses préréglages là où on les choisit (animations de texte, styles de texte,
   effets, dégradés…).
   - Les tiens : modifier (chargés dans l'éditeur, puis « Mettre à jour »), renommer sur place,
     dupliquer, supprimer. Un élément supprimé va dans la corbeille : il se restaure en un clic.
   - Les intégrés : masqués de la liste plutôt que supprimés, et remis quand on veut, un par un
     ou tous d'un coup (ici, ou dans Mes effets).
   Les intégrés masqués sont dans les réglages (settings.hiddenBuiltins[genre] = [id…]) ; la
   corbeille dans la bibliothèque (lib.trash, 60 éléments au plus). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  const TRASH_MAX = 60;

  /* Partie sans interface (testée) : masquage des intégrés et corbeille, sur un état simple
     { settings, lib }. */
  const Logic = {
    hiddenOf(settings, kind) {
      const m = settings.hiddenBuiltins;
      return m && typeof m === 'object' && Array.isArray(m[kind]) ? m[kind] : [];
    },
    setHidden(settings, kind, id, on) {
      if (!settings.hiddenBuiltins || typeof settings.hiddenBuiltins !== 'object') settings.hiddenBuiltins = {};
      const list = Logic.hiddenOf(settings, kind).filter(x => x !== id);
      if (on) list.push(id);
      settings.hiddenBuiltins[kind] = list;
    },
    restoreAll(settings, kind) {
      if (!settings.hiddenBuiltins) return 0;
      const kinds = kind ? [kind] : Object.keys(settings.hiddenBuiltins);
      let n = 0;
      kinds.forEach(k => { n += Logic.hiddenOf(settings, k).length; settings.hiddenBuiltins[k] = []; });
      return n;
    },
    // Liste sans les intégrés masqués ; `keep` (la valeur choisie) reste, même masquée.
    visible(settings, kind, list, idOf, keep) {
      const hidden = Logic.hiddenOf(settings, kind);
      return list.filter(x => hidden.indexOf(idOf(x)) < 0 || (keep !== undefined && idOf(x) === keep));
    },
    remove(lib, item) {
      lib.items = lib.items.filter(i => i !== item);
      lib.favorites = (lib.favorites || []).filter(k => k !== 'u:' + item.id);
      // Gardé pour la synchro : supprimé ici, il l'est aussi sur tes autres ordinateurs.
      (lib.removed || (lib.removed = [])).push(item.id);
      lib.trash = [Object.assign({}, item, { deleted: Date.now() })].concat(lib.trash || []).slice(0, TRASH_MAX);
    },
    // Restaurer : un nouvel identifiant, pour que la synchro ne le supprime pas à nouveau.
    restore(lib, trashed, newId) {
      lib.trash = (lib.trash || []).filter(x => x !== trashed);
      const it = Object.assign({}, trashed, { id: newId, created: Date.now() });
      delete it.deleted;
      lib.items.push(it);
      return it;
    }
  };

  if (typeof module === 'object' && module.exports && typeof window === 'undefined') { module.exports = Logic; return; }

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { h } = app.UI;
    const listeners = [];
    const changed = () => { app.persist(); listeners.forEach(fn => { try { fn(); } catch (e) { /* vue fermée */ } }); };
    const lib = () => app.S.lib;
    const typesOf = o => [].concat(o.itemType || []);

    const hiddenOf = kind => Logic.hiddenOf(app.settings(), kind);
    const isHidden = (kind, id) => hiddenOf(kind).indexOf(id) >= 0;
    const visible = (kind, list, idOf, keep) => Logic.visible(app.settings(), kind, list, idOf, keep);
    function setHidden(kind, id, on) { Logic.setHidden(app.settings(), kind, id, on); changed(); }
    function restoreAll(kind) { const n = Logic.restoreAll(app.settings(), kind); changed(); return n; }
    const hiddenCount = () => { const m = app.settings().hiddenBuiltins || {}; return Object.keys(m).reduce((n, k) => n + Logic.hiddenOf(app.settings(), k).length, 0); };

    function remove(item) {
      Logic.remove(lib(), item);
      changed();
      app.status.finish('ok', _T('« ') + item.name + _T(' » supprimé'), _T('Dans la corbeille : « Gérer… » ou Mes effets pour le restaurer.'));
    }
    function restore(trashed) { const it = Logic.restore(lib(), trashed, app.uid()); changed(); return it; }
    function duplicate(item) {
      const it = Object.assign(JSON.parse(JSON.stringify(item)), { id: app.uid(), created: Date.now(), name: item.name + _T(' (copie)') });
      lib().items.push(it);
      changed();
      return it;
    }

    /* Fenêtre « Gérer » d'une liste :
       o.title, o.kind (genre des intégrés), o.builtins [{ id, name }], o.itemType (type(s) des
       tiens), o.prefix ('b:' par défaut : valeur d'un intégré dans le menu), o.use(valeur) : le
       choisir (« Modifier » le charge dans l'éditeur), o.after() : rafraîchir la vue. */
    function open(o) {
      const types = typesOf(o), prefix = o.prefix === undefined ? 'b:' : o.prefix;
      const body = h('div', { class: 'manage' });
      let q = '', closeModal = () => {};
      const pick = v => { closeModal(); if (o.use) o.use(v); };
      const btn = (text, title, fn, cls) => { const b = h('button', { class: 'action quiet' + (cls ? ' ' + cls : ''), title }, text); b.addEventListener('click', fn); return b; };
      const match = name => !q || String(name).toLowerCase().indexOf(q) >= 0;
      function renameInline(li, item) {
        const name = li.querySelector('.li-name');
        const input = h('input', { class: 'textfield manage-rename', value: item.name, 'aria-label': _T('Nouveau nom') });
        let done = false;
        const save = ok => {
          if (done) return;
          done = true;
          const v = input.value.trim();
          if (ok && v && v !== item.name) { item.name = v; changed(); }
          draw();
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(true); } else if (e.key === 'Escape') { e.stopPropagation(); save(false); } });
        input.addEventListener('blur', () => save(true));
        name.replaceWith(input);
        input.focus();
        input.select();
      }
      function draw() {
        const keepFocus = document.activeElement && document.activeElement.classList.contains('manage-search');
        body.innerHTML = '';
        const mine = lib().items.filter(i => types.indexOf(i.type) >= 0 && (!o.filter || o.filter(i)));
        const builtins = o.builtins || [];
        if (mine.length + builtins.length > 12) {
          const s = h('input', { class: 'textfield manage-search', placeholder: _T('Rechercher'), value: q, 'aria-label': _T('Rechercher') });
          s.addEventListener('input', () => { q = s.value.trim().toLowerCase(); draw(); });
          body.appendChild(h('div', { class: 'search-row' }, s));
          if (keepFocus) setTimeout(() => { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 0);
        }
        // Les tiens (pas dans la vue « Corbeille » seule)
        if (!o.trashOnly) body.appendChild(h('div', { class: 'manage-head' }, _T('Les tiens') + ' · ' + mine.length));
        if (!mine.length && !o.trashOnly) body.appendChild(h('div', { class: 'note' }, _T('Aucun pour l\'instant : « Enregistrer… » ou « Capturer depuis la timeline » les ajoute ici.')));
        mine.filter(i => match(i.name)).sort((a, b) => b.created - a.created).forEach(item => {
          const li = h('div', { class: 'list-item' },
            h('span', { class: 'li-icon' }, '★'),
            h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, item.name)),
            h('div', { class: 'li-actions' },
              btn(_T('Modifier'), _T('Le charger dans l\'éditeur, puis « Mettre à jour »'), () => pick('u:' + item.id), 'li-main'),
              btn('✎', _T('Renommer'), () => renameInline(li, item)),
              btn('⧉', _T('Dupliquer'), () => { duplicate(item); draw(); }),
              btn('✕', _T('Supprimer (va dans la corbeille)'), () => { remove(item); draw(); }, 'danger')));
          li.querySelector('.li-name').addEventListener('dblclick', () => renameInline(li, item));
          body.appendChild(li);
        });
        // Les intégrés
        if (builtins.length) {
          const hidden = builtins.filter(b => isHidden(o.kind, b.id)).length;
          const all = hidden ? btn(_T('Tout remettre (') + hidden + ')', _T('Remettre tous les intégrés masqués'), () => { restoreAll(o.kind); draw(); }) : null;
          body.appendChild(h('div', { class: 'manage-head' }, _T('Intégrés') + ' · ' + (builtins.length - hidden) + ' / ' + builtins.length, all));
          builtins.filter(b => match(b.name)).forEach(b => {
            const off = isHidden(o.kind, b.id);
            body.appendChild(h('div', { class: 'list-item' + (off ? ' is-hidden' : '') },
              h('span', { class: 'li-icon' }, off ? '◌' : '●'),
              h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, b.name), off ? h('div', { class: 'li-meta' }, _T('masqué')) : null),
              h('div', { class: 'li-actions' },
                off ? btn('↺ ' + _T('Remettre'), _T('Le remettre dans la liste'), () => { setHidden(o.kind, b.id, false); draw(); }, 'li-main')
                  : btn(_T('Utiliser'), '', () => pick(prefix + b.id), 'li-main'),
                off ? null : btn(_T('Masquer'), _T('Le retirer de la liste (se remet ici à tout moment)'), () => { setHidden(o.kind, b.id, true); draw(); }))));
          });
        }
        // Corbeille
        const trashed = (lib().trash || []).filter(i => types.indexOf(i.type) >= 0 && match(i.name));
        if (o.trashOnly && !trashed.length) body.appendChild(h('div', { class: 'note' }, _T('La corbeille est vide.')));
        if (trashed.length) {
          body.appendChild(h('div', { class: 'manage-head' }, _T('Corbeille') + ' · ' + trashed.length));
          trashed.forEach(t => body.appendChild(h('div', { class: 'list-item is-hidden' },
            h('span', { class: 'li-icon' }, '🗑'),
            h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, t.name), h('div', { class: 'li-meta' }, _T('supprimé le ') + new Date(t.deleted).toLocaleDateString())),
            h('div', { class: 'li-actions' }, btn('↺ ' + _T('Restaurer'), '', () => { restore(t); draw(); }, 'li-main')))));
        }
      }
      draw();
      const p = app.modal(o.title || _T('Gérer'), body, [{ label: _T('Fermer'), value: true }]);
      // La fenêtre se ferme par son bouton : « Utiliser » / « Modifier » le déclenchent.
      closeModal = () => { const m = body.closest('.modal'); const b = m && m.querySelector('footer button'); if (b) b.click(); };
      p.then(() => { if (o.after) o.after(); });
      return p;
    }

    // Bouton « Gérer… » à côté d'un menu.
    function button(o) {
      const b = h('button', { class: 'action quiet manage-btn', title: _T('Modifier, renommer, supprimer ; masquer ou remettre les intégrés') }, '⚙ ' + _T('Gérer…'));
      b.addEventListener('click', () => open(typeof o === 'function' ? o() : o));
      return b;
    }
    // Un menu et son bouton « Gérer… » sur une ligne.
    const withManage = (pickerEl, o) => h('div', { class: 'pick-manage' }, pickerEl, button(o));

    // Corbeille de toute la bibliothèque (Mes effets).
    function openTrash(after) {
      return open({ title: _T('Corbeille'), itemType: Array.from(new Set((lib().trash || []).map(i => i.type))), filter: () => false, trashOnly: true, after });
    }

    app.manage = { open, button, withManage, visible, isHidden, setHidden, restoreAll, hiddenCount, remove, restore, duplicate, openTrash, onChange: fn => listeners.push(fn), Logic };
  });
})(typeof self !== 'undefined' ? self : this);
