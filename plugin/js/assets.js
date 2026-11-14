/* RR FX : ressources : les dossiers du disque liés au plugin (effets, SFX, polices, LUTs,
   titres, overlays…). Indexation, classement, recherche, et lecture des LUT .cube pour les
   aperçus. Sans DOM : testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXAssets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const TYPES = [
    { id: 'video', label: _T('Vidéos'), icon: '▶', exts: ['mov', 'mp4', 'm4v', 'webm', 'mxf', 'avi', 'mkv', 'mts', 'm2ts', 'wmv', 'mpg', 'mpeg'] },
    { id: 'image', label: 'Images', icon: '▣', exts: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'psd', 'webp', 'bmp', 'exr', 'tga', 'heic'] },
    { id: 'audio', label: _T('Sons & SFX'), icon: '♪', exts: ['wav', 'mp3', 'aif', 'aiff', 'm4a', 'flac', 'ogg', 'aac', 'caf', 'wma'] },
    { id: 'lut', label: 'LUTs', icon: '◐', exts: ['cube', '3dl', 'look', 'lut', 'csp', 'ilut'] },
    { id: 'font', label: _T('Polices'), icon: 'Aa', exts: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'] },
    { id: 'mogrt', label: _T('Titres'), icon: 'T', exts: ['mogrt'] },
    { id: 'preset', label: 'Presets', icon: '≡', exts: ['prfpset', 'rrfxpack', 'ffx', 'epr', 'aep', 'prproj'] }
  ];
  const typeById = {};
  const extType = {};
  TYPES.forEach(t => { typeById[t.id] = t; t.exts.forEach(e => { extType[e] = t.id; }); });

  // Dossiers jamais parcourus (système, caches, versions).
  const SKIP_DIRS = /^(\.|__MACOSX$|node_modules$|\$RECYCLE\.BIN$|System Volume Information$|Adobe Premiere Pro (Auto-Save|Audio Previews|Video Previews)$|Media Cache( Files)?$|Peak Files$)/i;

  // Type d'un fichier d'après son nom (null = ignoré). Les exports RR FX sont des presets.
  function classify(name) {
    const n = String(name).toLowerCase();
    if (n[0] === '.' || /^~\$|\.(tmp|part)$/.test(n)) return null;
    if (/\.(rrfx|cutfx)\.json$/.test(n)) return 'preset';
    const dot = n.lastIndexOf('.');
    return dot > 0 ? extType[n.slice(dot + 1)] || null : null;
  }

  const extOf = name => { const d = String(name).lastIndexOf('.'); return d > 0 ? String(name).slice(d + 1).toLowerCase() : ''; };
  const baseName = name => String(name).replace(/\.(rrfx|cutfx)\.json$/i, '').replace(/\.[^.]+$/, '');

  /* Parcourt un dossier (Node : fs.promises). Ne garde que les fichiers reconnus.
     opts : { max (fichiers), depth, onProgress(n), shouldStop() } → { files, truncated, scanned } */
  async function scanFolder(fs, path, rootDir, opts) {
    opts = opts || {};
    const max = opts.max || 50000, depth = opts.depth == null ? 12 : opts.depth, files = [];
    let truncated = false, seen = 0, lastTick = Date.now();
    async function walk(dir, rel, level) {
      if (truncated || (opts.shouldStop && opts.shouldStop())) return;
      let list;
      try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      const subdirs = [], wanted = [];
      for (const d of list) {
        if (d.isDirectory()) { if (!SKIP_DIRS.test(d.name) && level < depth) subdirs.push(d.name); continue; }
        if (!d.isFile() && !(d.isSymbolicLink && d.isSymbolicLink())) continue;
        const type = classify(d.name);
        if (type) wanted.push({ name: d.name, type });
      }
      // stat par paquets : taille et date, utiles au tri et au cache des vignettes.
      for (let i = 0; i < wanted.length && !truncated; i += 64) {
        const batch = wanted.slice(i, i + 64);
        const stats = await Promise.all(batch.map(w => fs.promises.stat(path.join(dir, w.name)).catch(() => null)));
        batch.forEach((w, k) => {
          if (truncated || !stats[k] || !stats[k].isFile()) return;
          if (files.length >= max) { truncated = true; return; }
          files.push({ rel: rel ? rel + '/' + w.name : w.name, type: w.type, size: stats[k].size, mtime: Math.round(stats[k].mtimeMs) });
        });
      }
      seen += list.length;
      if (opts.onProgress && Date.now() - lastTick > 120) { lastTick = Date.now(); opts.onProgress(files.length, seen); }
      for (const name of subdirs.sort((a, b) => a.localeCompare(b))) await walk(path.join(dir, name), rel ? rel + '/' + name : name, level + 1);
    }
    await walk(rootDir, '', 0);
    return { files, truncated, scanned: Date.now() };
  }

  /* Index fait depuis une liste de File du navigateur (input « webkitdirectory », mode démo). */
  function fromFileList(list) {
    const roots = {};
    Array.from(list || []).forEach(f => {
      const parts = String(f.webkitRelativePath || f.name).split('/');
      const rootName = parts.length > 1 ? parts.shift() : _T('Dossier');
      const type = classify(parts[parts.length - 1]);
      if (!type || parts.some(p => SKIP_DIRS.test(p) && p !== parts[parts.length - 1])) return;
      const r = roots[rootName] || (roots[rootName] = { files: [], truncated: false, scanned: Date.now() });
      r.files.push({ rel: parts.join('/'), type, size: f.size, mtime: f.lastModified || 0, file: f });
    });
    return roots;
  }

  /* Entrées à afficher, à partir de { racine: { files } }. sep : séparateur des chemins. */
  function entries(index, sep) {
    const out = [];
    Object.keys(index || {}).forEach(rootPath => {
      const r = index[rootPath], rootName = String(rootPath).split(/[\\/]/).filter(Boolean).pop() || rootPath;
      (r.files || []).forEach(f => {
        const slash = f.rel.lastIndexOf('/'), name = f.rel.slice(slash + 1);
        out.push({
          id: rootPath + '|' + f.rel, root: rootPath, rootName, rel: f.rel, file: f.file || null,
          path: f.file ? null : rootPath.replace(/[\\/]+$/, '') + (sep || '/') + f.rel.split('/').join(sep || '/'),
          name: baseName(name), fileName: name, ext: extOf(name), type: f.type,
          folder: slash > 0 ? f.rel.slice(0, slash) : '', size: f.size || 0, mtime: f.mtime || 0
        });
      });
    });
    return out;
  }

  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  /* Dossiers (chemin relatif complet, avec la racine) et nombre de fichiers dedans (sous-dossiers compris). */
  function folders(list) {
    const counts = new Map();
    list.forEach(e => {
      const parts = [e.rootName].concat(e.folder ? e.folder.split('/') : []);
      for (let i = 1; i <= parts.length; i++) {
        const key = (i === 1 ? e.root : e.root + '|' + parts.slice(1, i).join('/'));
        const c = counts.get(key) || { key, label: parts.slice(0, i).join(' / '), depth: i - 1, n: 0 };
        c.n++;
        counts.set(key, c);
      }
    });
    return Array.from(counts.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }

  /* opts : { type, folder (clé de folders()), search, favs (Set), favOnly, sort: 'name' | 'recent' | 'size' } */
  function filter(list, opts) {
    opts = opts || {};
    const words = norm(opts.search).split(/\s+/).filter(Boolean);
    const out = list.filter(e => {
      if (opts.type && opts.type !== 'all' && e.type !== opts.type) return false;
      if (opts.favOnly && !(opts.favs && opts.favs.has(e.id))) return false;
      if (opts.folder) {
        const k = opts.folder, inRoot = k === e.root, sub = k.indexOf('|') > 0 ? k.slice(k.indexOf('|') + 1) : null;
        if (!inRoot && !(k.slice(0, k.indexOf('|')) === e.root && sub !== null && (e.folder === sub || e.folder.indexOf(sub + '/') === 0))) return false;
      }
      if (words.length) {
        const hay = norm(e.name + ' ' + e.folder + ' ' + e.ext + ' ' + (typeById[e.type] ? typeById[e.type].label : ''));
        if (!words.every(w => hay.indexOf(w) >= 0)) return false;
      }
      return true;
    });
    const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
    if (opts.sort === 'recent') out.sort((a, b) => b.mtime - a.mtime || byName(a, b));
    else if (opts.sort === 'size') out.sort((a, b) => b.size - a.size || byName(a, b));
    else out.sort((a, b) => (a.folder === b.folder ? 0 : a.folder < b.folder ? -1 : 1) || byName(a, b));
    return out;
  }

  function counts(list) {
    const c = { all: list.length };
    TYPES.forEach(t => { c[t.id] = 0; });
    list.forEach(e => { c[e.type]++; });
    return c;
  }

  function formatSize(n) {
    if (n < 1024) return n + _T(' o');
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + _T(' Ko');
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + _T(' Mo');
    return (n / 1073741824).toFixed(1).replace('.', ',') + _T(' Go');
  }

  // ---------------------------------------------------------------- LUT .cube

  /* LUT .cube (Resolve / Adobe) : 3D (LUT_3D_SIZE), 1D (LUT_1D_SIZE), ou les deux (format Resolve :
     table 1D « shaper » d'abord, puis la 3D). Avec les deux, le résultat est la 3D et la 1D va dans
     lut.shaper (appliquée avant par applyLut). *_INPUT_RANGE min max = DOMAIN_MIN / DOMAIN_MAX. */
  function parseCube(text) {
    const lut = { title: '', size: 0, dim: 3, min: [0, 0, 0], max: [1, 1, 1], data: null };
    const values = [];
    let n1 = 0, n3 = 0, dom = null, r1 = null, r3 = null;
    String(text).split(/\r?\n/).forEach(line => {
      const l = line.trim();
      if (!l || l[0] === '#') return;
      let m;
      if ((m = /^TITLE\s+"?([^"]*)"?/i.exec(l))) lut.title = m[1];
      else if ((m = /^LUT_3D_SIZE\s+(\d+)/i.exec(l))) n3 = +m[1];
      else if ((m = /^LUT_1D_SIZE\s+(\d+)/i.exec(l))) n1 = +m[1];
      else if ((m = /^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(l))) (dom = dom || {}).min = [+m[1], +m[2], +m[3]];
      else if ((m = /^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(l))) (dom = dom || {}).max = [+m[1], +m[2], +m[3]];
      else if ((m = /^LUT_3D_INPUT_RANGE\s+(\S+)\s+(\S+)/i.exec(l))) r3 = { min: [+m[1], +m[1], +m[1]], max: [+m[2], +m[2], +m[2]] };
      else if ((m = /^LUT_1D_INPUT_RANGE\s+(\S+)\s+(\S+)/i.exec(l))) r1 = { min: [+m[1], +m[1], +m[1]], max: [+m[2], +m[2], +m[2]] };
      else if (/^[-+.\d]/.test(l)) {
        const v = l.split(/\s+/).map(Number);
        if (v.length >= 3 && v.slice(0, 3).every(isFinite)) values.push(v[0], v[1], v[2]);
      }
    });
    if (n1 > 256 || n3 > 256) throw new Error(_T('LUT trop grande'));
    const need1 = n1 * 3, need3 = n3 * n3 * n3 * 3;
    if (!(n1 >= 2 || n3 >= 2) || (n1 && n1 < 2) || (n3 && n3 < 2) || values.length < need1 + need3) throw new Error(_T('LUT .cube illisible'));
    const range = (r, d) => ({ min: (r || d || {}).min || [0, 0, 0], max: (r || d || {}).max || [1, 1, 1] });
    if (n3) {
      // DOMAIN_* sans précision de table : il décrit la 3D (l'entrée de la LUT dans un fichier 3D seul).
      const r = range(r3, n1 ? null : dom);
      Object.assign(lut, { size: n3, dim: 3, min: r.min, max: r.max, data: Float32Array.from(values.slice(need1, need1 + need3)) });
      if (n1) { const s = range(r1, dom); lut.shaper = { size: n1, min: s.min, max: s.max, data: Float32Array.from(values.slice(0, need1)) }; }
    } else {
      const r = range(r1, dom);
      Object.assign(lut, { size: n1, dim: 1, min: r.min, max: r.max, data: Float32Array.from(values.slice(0, need1)) });
    }
    return lut;
  }

  /* Applique la LUT aux pixels RVBA (Uint8ClampedArray), sur place. Interpolation trilinéaire. */
  function applyLut(px, lut) {
    const N = lut.size, d = lut.data, mn = lut.min, mx = lut.max, M = N - 1;
    const cl = v => (v < 0 ? 0 : v > M ? M : v);
    // Position dans la table pour chaque valeur 0..255 de chaque canal (shaper 1D d'abord s'il y en a un).
    const sh = lut.shaper, pos = [0, 1, 2].map(c => {
      const t = new Float32Array(256), span = Math.max(1e-6, mx[c] - mn[c]);
      for (let v = 0; v < 256; v++) {
        let x = v / 255;
        if (sh) {
          const S = sh.size - 1, k = Math.min(S, Math.max(0, (x - sh.min[c]) / Math.max(1e-6, sh.max[c] - sh.min[c]) * S));
          const i0 = Math.floor(k), i1 = Math.min(S, i0 + 1), u = k - i0;
          x = sh.data[i0 * 3 + c] * (1 - u) + sh.data[i1 * 3 + c] * u;
        }
        t[v] = cl((x - mn[c]) / span * M);
      }
      return t;
    });
    for (let p = 0; p < px.length; p += 4) {
      const r = pos[0][px[p]], g = pos[1][px[p + 1]], b = pos[2][px[p + 2]];
      if (lut.dim === 1) {
        const ch = [r, g, b];
        for (let c = 0; c < 3; c++) {
          const i0 = Math.floor(ch[c]), i1 = Math.min(M, i0 + 1), u = ch[c] - i0;
          px[p + c] = 255 * (d[i0 * 3 + c] * (1 - u) + d[i1 * 3 + c] * u);
        }
        continue;
      }
      const r0 = Math.floor(r), g0 = Math.floor(g), b0 = Math.floor(b);
      const r1 = Math.min(M, r0 + 1), g1 = Math.min(M, g0 + 1), b1 = Math.min(M, b0 + 1);
      const fr = r - r0, fg = g - g0, fb = b - b0;
      // .cube : le rouge varie le plus vite.
      const at = (ri, gi, bi) => (ri + gi * N + bi * N * N) * 3;
      for (let c = 0; c < 3; c++) {
        const c00 = d[at(r0, g0, b0) + c] * (1 - fr) + d[at(r1, g0, b0) + c] * fr;
        const c10 = d[at(r0, g1, b0) + c] * (1 - fr) + d[at(r1, g1, b0) + c] * fr;
        const c01 = d[at(r0, g0, b1) + c] * (1 - fr) + d[at(r1, g0, b1) + c] * fr;
        const c11 = d[at(r0, g1, b1) + c] * (1 - fr) + d[at(r1, g1, b1) + c] * fr;
        px[p + c] = 255 * ((c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb);
      }
    }
    return px;
  }

  // Effet Lumetri dans les langues de Premiere (pour le calque de réglage « LUT »).
  // Nom de fichier sans accents ni caractères interdits (Windows, macOS).
  function fileSlug(s, fallback, max) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\- .]+/g, '').trim().replace(/\s+/g, ' ').slice(0, max || 60).trim() || fallback || 'fichier';
  }
  // Empreinte d'un texte (FNV-1a 32 bits, sur tout le texte) pour nommer un fichier d'après son contenu.
  function hashText(text) {
    let x = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193); }
    return (x >>> 0).toString(36);
  }

  const LUMETRI_NAMES = ['Lumetri Color', 'Couleur Lumetri', 'Lumetri-Farbe', 'Color Lumetri', 'Colore Lumetri', 'Cor Lumetri'];

  return { TYPES, typeById, classify, extOf, baseName, scanFolder, fromFileList, entries, folders, filter, counts, formatSize, parseCube, applyLut, fileSlug, hashText, LUMETRI_NAMES, SKIP_DIRS };
});
