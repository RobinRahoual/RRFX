/* RR FX : le dossier « assets » du projet, rangé tout seul.
   À côté du projet Premiere (.prproj), un dossier assets avec une sous-dossier par catégorie :
   VIDEOS, MUSIQUE, SFX, VOIX, IMAGES, GRAPHIQUES, SOUS-TITRES, LUTS, POLICES, DIVERS.
   - Ce que RR FX télécharge (import par lien) ou fabrique (voix off, voix débruitées, pistes
     séparées, détourages, ralentis, sons, images…) va directement dans la bonne catégorie, et
     dans le chutier du même nom du panneau Projet (assets › VIDEOS…).
   - « Ranger le dossier assets » classe les fichiers déposés en vrac dans assets : ceux que le
     projet utilise déjà sont déplacés puis reliés (rien ne passe hors ligne).
   - Option : rangement automatique de ce que tu déposes dans assets, panneau ouvert.
   Projet jamais enregistré : Documents/RRFX, comme avant. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXDossiers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATS = [
    { id: 'VIDEOS', exts: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'mxf', 'm4v', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'braw', 'r3d'] },
    { id: 'MUSIQUE', exts: [] },
    { id: 'SFX', exts: [] },
    { id: 'VOIX', exts: [] },
    { id: 'IMAGES', exts: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'psd', 'webp', 'bmp', 'exr', 'tga', 'heic', 'dpx'] },
    { id: 'GRAPHIQUES', exts: ['mogrt', 'aep', 'ai', 'svg', 'eps', 'pdf', 'lottie'] },
    { id: 'SOUS-TITRES', exts: ['srt', 'vtt', 'ass', 'ssa', 'scc', 'stl'] },
    { id: 'LUTS', exts: ['cube', '3dl', 'look', 'lut', 'dctl'] },
    { id: 'POLICES', exts: ['ttf', 'otf', 'woff', 'woff2'] },
    { id: 'DIVERS', exts: [] }
  ];
  const AUDIO = ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'caf'];
  const NAMES = CATS.map(c => c.id);
  // Un son plus long que ça est une musique ; plus court, un bruitage.
  const MUSIC_SECONDS = 45;
  // Débit moyen pour estimer une durée d'après la taille (bits/s).
  const BITRATE = { mp3: 192000, m4a: 160000, aac: 160000, ogg: 160000, opus: 128000, wma: 160000, flac: 900000, wav: 1536000, aif: 1536000, aiff: 1536000, caf: 1536000 };

  const extOf = name => { const m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
  const isAudio = name => AUDIO.indexOf(extOf(name)) >= 0;
  // Durée approchée d'un son d'après sa taille (s), ou null.
  const audioSeconds = (name, bytes) => (bytes > 0 && BITRATE[extOf(name)] ? bytes * 8 / BITRATE[extOf(name)] : null);

  /* Catégorie d'un fichier. info : { duration (s), bytes, kind: 'voice' | 'music' | 'sfx' }.
     Un son : VOIX (kind ou nom), puis MUSIQUE / SFX d'après la durée (ou la taille), sinon le
     nom (musique, beat, remix… / whoosh, impact…), sinon SFX. */
  function categoryOf(name, info) {
    const i = info || {}, ext = extOf(name), n = String(name || '').toLowerCase();
    if (isAudio(name)) {
      if (i.kind === 'voice' || /(^|[^a-z])(voix|voice|vo|narration|dialogue|interview|podcast)([^a-z]|$)/.test(n)) return 'VOIX';
      if (i.kind === 'music') return 'MUSIQUE';
      if (i.kind === 'sfx') return 'SFX';
      const d = i.duration > 0 ? i.duration : audioSeconds(name, i.bytes);
      if (d !== null && d !== undefined) return d >= MUSIC_SECONDS ? 'MUSIQUE' : 'SFX';
      if (/(music|musique|song|chanson|beat|instrumental|remix|track|ost|lofi|full)/.test(n)) return 'MUSIQUE';
      return 'SFX';
    }
    const c = CATS.find(x => x.exts.indexOf(ext) >= 0);
    return c ? c.id : 'DIVERS';
  }

  /* Dossier d'une catégorie à côté du projet : { dir, bin, sub }. sub : sous-dossier en plus
     (« Détourages »…). Projet jamais enregistré : null. path : module path de Node. */
  function assetsDir(projectPath, cat, path, sub) {
    const p = String(projectPath || '');
    if (!/\.prproj$/i.test(p)) return null;
    const c = NAMES.indexOf(cat) >= 0 ? cat : 'DIVERS';
    const dir = path.join(path.dirname(p), 'assets', c);
    return { dir: sub ? path.join(dir, sub) : dir, bin: 'assets/' + c, sub: c };
  }
  const assetsRoot = (projectPath, path) => (/\.prproj$/i.test(String(projectPath || '')) ? path.join(path.dirname(String(projectPath)), 'assets') : null);

  /* Fichiers en vrac à la racine d'assets → déplacements [{ from, to, cat, used }]. files :
     [{ name, bytes }] ; used(chemin) : le projet s'en sert (déplacé puis relié). Un nom déjà pris
     dans la catégorie reçoit « (2) », « (3) »… exists(chemin). */
  function planSort(root, files, path, used, exists) {
    const taken = new Set();
    return files.filter(f => f.name && !/^\./.test(f.name) && !/\.(part|ytdl|tmp|crdownload)$/i.test(f.name) && NAMES.indexOf(f.name) < 0).map(f => {
      const cat = categoryOf(f.name, { bytes: f.bytes });
      const from = path.join(root, f.name), dot = f.name.lastIndexOf('.');
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot) : '';
      let to = path.join(root, cat, f.name), k = 2;
      while (taken.has(to) || (exists && exists(to))) to = path.join(root, cat, stem + ' (' + (k++) + ')' + ext);
      taken.add(to);
      return { from, to, cat, used: !!(used && used(from)) };
    });
  }

  /* Arguments yt-dlp en plus : la durée de la vidéo, avant le téléchargement, sur une ligne
     RRFXDUR=… (pour ranger un son en MUSIQUE ou SFX). */
  const DURATION_ARGS = ['--no-simulate', '--print', 'before_dl:RRFXDUR=%(duration)s'];
  const durationOf = line => { const m = /^RRFXDUR=(\d+(?:\.\d+)?)/.exec(String(line || '').trim()); return m ? +m[1] : null; };

  return { CATS, NAMES, AUDIO, MUSIC_SECONDS, extOf, isAudio, audioSeconds, categoryOf, assetsDir, assetsRoot, planSort, DURATION_ARGS, durationOf };
});

/* Partie panneau : le dossier assets du projet ouvert, et son rangement. */
(function (root) {
  'use strict';
  if (typeof window === 'undefined') return;
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const D = root.RRFXDossiers, { Store, Host } = app;
    const { h, section, checkbox } = app.UI;
    const st = () => { const s = app.settings(); if (!s.assetsFolder || typeof s.assetsFolder !== 'object') s.assetsFolder = { auto: false }; return s.assetsFolder; };
    const projectPath = () => (app.S.ctx && app.S.ctx.projectPath) || '';

    /* Dossier où ranger un fichier de catégorie cat (sync : chemin du projet relu toutes les 2 s).
       fallback : sous-dossier de Documents/RRFX quand le projet n'est pas enregistré. Crée le
       dossier. → { dir, bin, sub, inProject } */
    function dirFor(cat, opts) {
      const o = opts || {};
      if (!Store.fs) return { dir: '', bin: '', sub: '', inProject: false };
      const a = Store.fs ? D.assetsDir(o.projectPath || projectPath(), cat, Store.path, o.sub) : null;
      if (a) { Store.fs.mkdirSync(a.dir, { recursive: true }); return Object.assign(a, { inProject: true }); }
      const dir = Store.path.join(Store.dir, o.fallback || 'Fabriqué', o.sub || '');
      if (Store.fs) Store.fs.mkdirSync(dir, { recursive: true });
      return { dir, bin: '', sub: '', inProject: false };
    }
    // Comme dirFor, avec le chemin du projet demandé à Premiere à l'instant (avant un import).
    async function dirForNow(cat, opts) {
      const ctx = await Host.call('getContext', {});
      return dirFor(cat, Object.assign({}, opts, { projectPath: ctx && ctx.ok ? ctx.projectPath : '' }));
    }
    // Un fichier déjà écrit, déplacé dans sa vraie catégorie (son : MUSIQUE ou SFX…). → chemin.
    function moveTo(file, cat) {
      const pp = projectPath(), a = Store.fs ? D.assetsDir(pp, cat, Store.path) : null;
      if (!a || Store.path.dirname(file) === a.dir) return file;
      Store.fs.mkdirSync(a.dir, { recursive: true });
      let to = Store.path.join(a.dir, Store.path.basename(file)), k = 2;
      const ext = Store.path.extname(file), stem = Store.path.basename(file, ext);
      while (Store.fs.existsSync(to)) to = Store.path.join(a.dir, stem + ' (' + (k++) + ')' + ext);
      try { Store.fs.renameSync(file, to); return to; } catch (e) { return file; }
    }

    /* Range les fichiers en vrac à la racine d'assets. quiet : rangement automatique (seulement
       les fichiers que le projet n'utilise pas, sans message). → { moved, relinked, failed } */
    async function sortLoose(quiet) {
      const pm = await Host.call('projectMedia', {});
      const rootDir = pm.ok ? D.assetsRoot(pm.projectPath, Store.path) : null;
      if (!rootDir) return { error: _T('Enregistre ton projet Premiere : le dossier assets se crée à côté du fichier .prproj.') };
      if (!Store.fs.existsSync(rootDir)) return { moved: 0, relinked: 0, failed: [], root: rootDir };
      const used = new Set((pm.paths || []).map(p => String(p).replace(/\\/g, '/').toLowerCase()));
      const isUsed = p => used.has(String(p).replace(/\\/g, '/').toLowerCase());
      const files = Store.fs.readdirSync(rootDir).filter(n => { try { return Store.fs.statSync(Store.path.join(rootDir, n)).isFile(); } catch (e) { return false; } })
        .map(n => ({ name: n, bytes: Store.fs.statSync(Store.path.join(rootDir, n)).size }));
      const plan = D.planSort(rootDir, files, Store.path, isUsed, p => Store.fs.existsSync(p)).filter(m => !quiet || !m.used);
      let moved = 0;
      const relink = [], failed = [];
      for (const m of plan) {
        try {
          Store.fs.mkdirSync(Store.path.dirname(m.to), { recursive: true });
          Store.fs.renameSync(m.from, m.to);
          moved++;
          if (m.used) relink.push(m);
        } catch (e) { failed.push(Store.path.basename(m.from)); }
      }
      let relinked = 0;
      if (relink.length) {
        const r = await Host.call('relinkMedia', { moves: relink.map(m => ({ from: m.from, to: m.to })) });
        relinked = r.ok ? r.done : 0;
        // Refusé par Premiere : le fichier revient à sa place (rien hors ligne).
        (r.ok ? r.failed : relink.map(m => m.from)).forEach(f => {
          const m = relink.find(x => x.from === f);
          if (m) { try { Store.fs.renameSync(m.to, m.from); moved--; failed.push(Store.path.basename(f)); } catch (e) { /* laissé déplacé */ } }
        });
      }
      return { moved, relinked, failed, root: rootDir, plan };
    }

    function sortNow() {
      return app.runTask(_T('Rangement du dossier assets'), async () => {
        if (!Store.fs) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('Le rangement se fait sur ton disque, depuis Premiere.') };
        const r = await sortLoose(false);
        if (r.error) return { kind: 'warn', title: _T('Projet pas encore enregistré'), detail: r.error };
        if (!r.moved && !r.failed.length) return { kind: 'ok', title: _T('Dossier assets déjà rangé'), detail: r.root };
        const cats = {};
        (r.plan || []).forEach(m => { cats[m.cat] = (cats[m.cat] || 0) + 1; });
        return {
          kind: r.failed.length ? 'warn' : 'ok', title: app.plural(r.moved, _T('fichier rangé'), _T('fichiers rangés')),
          detail: Object.keys(cats).map(c => c + ' ' + cats[c]).join(' · ') + (r.relinked ? ' · ' + app.plural(r.relinked, _T('élément du projet relié'), _T('éléments du projet reliés')) : '') + (r.failed.length ? _T(' · non déplacés : ') + r.failed.join(', ') : '')
        };
      });
    }

    // Rangement automatique (option) : toutes les 20 s, ce qui est déposé en vrac et pas encore utilisé.
    let busy = false;
    setInterval(async () => {
      if (!Store.fs || busy || !st().auto || !/\.prproj$/i.test(projectPath())) return;
      busy = true;
      try { const r = await sortLoose(true); if (r.moved) app.log(app.plural(r.moved, _T('fichier rangé'), _T('fichiers rangés')) + _T(' dans assets (automatique)'), 'ok'); } catch (e) { /* réessayé plus tard */ }
      busy = false;
    }, 20000);

    function render() {
      const pp = projectPath(), rootDir = Store.path ? D.assetsRoot(pp, Store.path) : null;
      const go = h('button', { class: 'action go' }, _T('Ranger le dossier assets'));
      go.addEventListener('click', sortNow);
      const open = h('button', { class: 'action', disabled: !rootDir }, _T('Ouvrir le dossier'));
      open.addEventListener('click', () => { if (rootDir) { Store.fs.mkdirSync(rootDir, { recursive: true }); Store.reveal(rootDir); } });
      return [
        h('div', { class: 'note' }, rootDir ? _T('Dossier : ') + rootDir : _T('Enregistre ton projet : le dossier assets se crée à côté du fichier .prproj.')),
        h('div', { class: 'note' }, _T('Ce que RR FX télécharge ou fabrique s\'y range tout seul : ') + D.NAMES.join(', ') + _T('. Les sons de plus de ') + D.MUSIC_SECONDS + _T(' s vont dans MUSIQUE, les plus courts dans SFX. Même rangement dans le panneau Projet (chutiers assets › …).')),
        h('div', { class: 'row-buttons' }, go, open),
        h('div', { class: 'field' }, checkbox(_T('Ranger aussi ce que je dépose dans assets (toutes les 20 s)'), st().auto, v => { st().auto = v; app.persist(); })),
        h('div', { class: 'note' }, _T('« Ranger » classe les fichiers posés en vrac dans assets ; ceux que ton projet utilise déjà sont déplacés puis reliés, rien ne passe hors ligne. Le rangement automatique ne touche qu\'aux fichiers pas encore importés.'))
      ];
    }

    app.assetsFolder = { dirFor, dirForNow, moveTo, sortLoose, sortNow, render };
    app.actions.sortAssets = sortNow;
    // Onglet Ressources, avec le rangement du projet.
    app.extras.assets.push({ id: 'assets-folder', title: _T('Dossier assets du projet'), nav: 'Assets', tool: [_T('Ranger le dossier assets'), sortNow], render });
  });
})(typeof self !== 'undefined' ? self : this);
