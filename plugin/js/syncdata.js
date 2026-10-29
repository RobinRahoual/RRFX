/* RR FX : synchro des réglages entre ordinateurs, par un dossier partagé (Dropbox, iCloud Drive,
   OneDrive, Google Drive pour ordinateur…). Fonctions pures : ce qui part dans le fichier, et
   comment il se fond dans la bibliothèque d'un autre ordinateur.
   - Effets perso, looks, styles… : réunis (rien n'est perdu d'un côté ni de l'autre), sauf ceux
     supprimés depuis sur l'un des deux.
   - Réglages : ceux de l'ordinateur modifié en dernier, sauf ce qui est propre à chaque machine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXSyncData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FILE = 'RR FX - synchro.json';
  // Propres à chaque ordinateur : jamais envoyés, jamais remplacés.
  const LOCAL = ['sync', 'remote', 'adjNodeId', 'welcomed', 'lang', 'tab', 'compact', 'folded', 'assets'];
  const MAX_REMOVED = 300;

  const clone = o => JSON.parse(JSON.stringify(o));
  function shared(settings) {
    const out = {};
    Object.keys(settings || {}).forEach(k => { if (LOCAL.indexOf(k) < 0) out[k] = clone(settings[k]); });
    return out;
  }

  /* Contenu du fichier de synchro. */
  function pack(lib, machine, now) {
    return {
      rrfx: 1, kind: 'rrfx-sync', machine, savedAt: now,
      items: clone(lib.items || []), favorites: clone(lib.favorites || []), removed: clone(lib.removed || []),
      settings: shared(lib.settings)
    };
  }

  function valid(remote) {
    return !!remote && remote.kind === 'rrfx-sync' && Array.isArray(remote.items) && remote.settings && typeof remote.settings === 'object' && typeof remote.savedAt === 'number';
  }

  /* Bibliothèque locale + fichier reçu → { lib, added, removed, settings (bool) }. La locale
     n'est pas modifiée. localUpdated : dernière modification locale (ms). */
  function merge(local, remote, localUpdated) {
    if (!valid(remote)) throw new Error('Fichier de synchro illisible.');
    const lib = clone(local), newer = remote.savedAt > (localUpdated || 0);
    const gone = new Set((lib.removed || []).concat(remote.removed || []));
    const before = new Set(lib.items.map(i => i.id));
    const byId = new Map(lib.items.map(i => [i.id, i]));
    remote.items.forEach(i => {
      if (!i || !i.id || gone.has(i.id)) return;
      // Même élément des deux côtés : la version du côté modifié en dernier.
      if (!byId.has(i.id) || newer) byId.set(i.id, clone(i));
    });
    lib.items = Array.from(byId.values()).filter(i => !gone.has(i.id));
    const added = lib.items.filter(i => !before.has(i.id)).length;
    const removed = before.size - lib.items.filter(i => before.has(i.id)).length;
    lib.removed = Array.from(gone).slice(-MAX_REMOVED);
    if (newer) {
      const keep = {};
      LOCAL.forEach(k => { if (k in lib.settings) keep[k] = lib.settings[k]; });
      lib.settings = Object.assign(clone(remote.settings), keep);
      lib.favorites = clone(remote.favorites || lib.favorites || []).filter(k => !gone.has(String(k).replace(/^u:/, '')));
    }
    return { lib, added, removed, settings: newer };
  }

  return { FILE, LOCAL, pack, merge, valid };
});
