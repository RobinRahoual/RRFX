/* RR FX : synchro des réglages et de Mes effets entre tes ordinateurs, par un dossier que ton
   service de stockage synchronise déjà (Dropbox, iCloud Drive, OneDrive, Google Drive…). RR FX
   y écrit un fichier après chaque changement et reprend, au démarrage et toutes les minutes, ce
   qu'un autre ordinateur y a mis. Aucun compte, aucun serveur RR FX. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const SD = root.RRFXSyncData, { Store } = app;
    const { h, section } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.sync || typeof s.sync !== 'object') s.sync = {};
      const d = { dir: '', machine: '', lastPush: 0, lastPull: 0, seen: 0 };
      Object.keys(d).forEach(k => { if (!(k in s.sync)) s.sync[k] = d[k]; });
      if (!s.sync.machine) s.sync.machine = ((Store.os && Store.os.hostname && Store.os.hostname()) || _T('ordinateur')) + ' · ' + Math.random().toString(36).slice(2, 6);
      return s.sync;
    };
    const file = () => (st().dir && Store.fs ? Store.path.join(st().dir, SD.FILE) : '');
    const machineName = m => String(m || '').replace(/ · [a-z0-9]{4}$/, '');
    const hhmm = t => { if (!t) return _T('jamais'); const d = new Date(t); return d.toLocaleDateString() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

    let pushTimer = 0, writing = false;
    function push(now) {
      const f = file();
      if (!f) return false;
      writing = true;
      try {
        const data = SD.pack(app.S.lib, st().machine, Date.now());
        const tmp = f + '.tmp';
        Store.fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
        Store.fs.renameSync(tmp, f);
        st().lastPush = data.savedAt;
        st().seen = data.savedAt;
        if (now) app.log(_T('Synchro : réglages envoyés dans ') + st().dir, 'ok');
        return true;
      } catch (e) {
        app.log(_T('Synchro : envoi impossible (') + app.errorMessage(e) + ')', 'warn');
        return false;
      } finally { writing = false; }
    }

    // Réglages repris en place : les onglets gardent leurs références sur ces objets.
    function intoPlace(target, src) {
      Object.keys(target).forEach(k => { if (!(k in src) && SD.LOCAL.indexOf(k) < 0) delete target[k]; });
      Object.keys(src).forEach(k => {
        const a = target[k], b = src[k];
        if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) intoPlace(a, b);
        else target[k] = b;
      });
    }

    /* Reprend le fichier s'il vient d'un autre ordinateur (ou si force). → résumé, ou ''. */
    function pull(force) {
      const f = file();
      if (!f || !Store.fs.existsSync(f)) return '';
      let remote;
      try { remote = JSON.parse(Store.fs.readFileSync(f, 'utf8')); } catch (e) { app.log(_T('Synchro : fichier illisible (') + app.errorMessage(e) + ')', 'warn'); return ''; }
      if (!SD.valid(remote)) return '';
      const x = st();
      if (!force && (remote.machine === x.machine || remote.savedAt <= x.seen)) return '';
      const lib = app.S.lib, r = SD.merge({ items: lib.items, favorites: lib.favorites, removed: lib.removed || [], settings: lib.settings }, remote, lib.updated || 0);
      lib.items.splice(0, lib.items.length, ...r.lib.items);
      lib.removed = r.lib.removed;
      if (r.settings) {
        lib.favorites.splice(0, lib.favorites.length, ...r.lib.favorites);
        intoPlace(lib.settings, r.lib.settings);
      }
      x.seen = remote.savedAt;
      x.lastPull = Date.now();
      app.persist();
      const parts = [];
      if (r.added) parts.push(app.plural(r.added, _T('élément ajouté'), _T('éléments ajoutés')));
      if (r.removed) parts.push(app.plural(r.removed, _T('élément retiré'), _T('éléments retirés')));
      if (r.settings) parts.push(_T('réglages repris'));
      const what = parts.join(', ') || _T('déjà à jour');
      app.log(_T('Synchro depuis « ') + machineName(remote.machine) + _T(' » : ') + what, 'ok');
      return what;
    }

    function afterPull(what, from) {
      if (!what) return;
      app.switchTab(app.S.tab);
      app.status.finish('ok', _T('Réglages synchronisés'), _T('Depuis ') + from + ' : ' + what + '.');
    }

    app.afterSave.push(() => {
      if (!file() || writing) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => push(false), 3000);
    });
    let checker = 0;
    function watch() {
      clearInterval(checker);
      if (!file()) return;
      checker = setInterval(() => {
        if (app.S.busy) return;
        try {
          const f = file();
          if (!f || !Store.fs.existsSync(f) || Store.fs.statSync(f).mtimeMs <= st().seen) return;
          const remote = JSON.parse(Store.fs.readFileSync(f, 'utf8'));
          afterPull(pull(false), _T('« ') + machineName(remote.machine) + _T(' »'));
        } catch (e) { /* fichier en cours d'écriture : prochain tour */ }
      }, 60000);
    }
    app.whenReady.push(() => {
      if (!file()) return;
      try {
        const f = file(), remote = Store.fs.existsSync(f) ? JSON.parse(Store.fs.readFileSync(f, 'utf8')) : null;
        const what = pull(false);
        if (what) afterPull(what, _T('« ') + machineName(remote && remote.machine) + _T(' »'));
      } catch (e) { app.log(_T('Synchro : ') + app.errorMessage(e), 'warn'); }
      watch();
    });

    function syncSection() {
      const x = st(), box = h('div');
      const draw = () => {
        box.innerHTML = '';
        if (!Store.fs) { box.appendChild(h('div', { class: 'note' }, _T('Disponible dans Premiere (mode démo ici).'))); return; }
        if (!x.dir) {
          box.appendChild(h('div', { class: 'note' }, _T('Tes effets perso, looks, styles, couleurs, raccourcis et réglages sur tous tes ordinateurs. Choisis un dossier que Dropbox, iCloud Drive, OneDrive ou Google Drive synchronise déjà, et fais pareil sur l\'autre ordinateur : RR FX fait le reste.')));
        } else {
          box.appendChild(h('div', { class: 'note' }, _T('Dossier : ') + x.dir));
          box.appendChild(h('div', { class: 'note' }, _T('Dernier envoi : ') + hhmm(x.lastPush) + _T(' · dernière reprise : ') + hhmm(x.lastPull) + _T('. Propres à cet ordinateur : dossiers liés, calque de réglage, télécommande, langue.')));
        }
        const pick = h('button', { class: 'action' + (x.dir ? '' : ' go') }, x.dir ? _T('Changer de dossier…') : _T('Choisir le dossier de synchro…'));
        pick.addEventListener('click', () => {
          const dirs = Store.pickFiles(_T('Dossier de synchro (Dropbox, iCloud Drive, OneDrive…)'), [], true);
          if (!dirs || !dirs.length) return;
          x.dir = dirs[0];
          x.seen = 0;
          // Un fichier existe déjà (autre ordinateur) : on le reprend d'abord, puis on envoie.
          const what = pull(true);
          push(true);
          app.persist();
          watch();
          draw();
          app.status.finish('ok', _T('Synchro en place'), what ? _T('Repris : ') + what + _T('. Fais pareil sur ton autre ordinateur.') : _T('Réglages envoyés. Choisis le même dossier sur ton autre ordinateur.'));
        });
        const row2 = [pick];
        if (x.dir) {
          const now = h('button', { class: 'action quiet' }, _T('Envoyer maintenant'));
          now.addEventListener('click', () => { if (push(true)) { draw(); app.status.finish('ok', _T('Réglages envoyés'), x.dir); } });
          const get = h('button', { class: 'action quiet' }, _T('Reprendre maintenant'));
          get.addEventListener('click', () => { const w = pull(true); draw(); afterPull(w || _T('déjà à jour'), _T('le dossier de synchro')); });
          const off = h('button', { class: 'action quiet danger' }, _T('Arrêter'));
          off.addEventListener('click', () => { x.dir = ''; clearInterval(checker); app.persist(); draw(); });
          row2.push(now, get, off);
        }
        box.appendChild(h('div', { class: 'row-buttons wrap' }, row2));
      };
      draw();
      return section(_T('Synchro entre ordinateurs'), [box], null, !x.dir);
    }
    app.settingsExtras.push(syncSection);
    app.sync = { push, pull };
  });
})(typeof self !== 'undefined' ? self : this);
