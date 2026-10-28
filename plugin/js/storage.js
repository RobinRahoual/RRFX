/* RR FX : bibliothèque perso, réglages et historique sur disque
   (Documents/RRFX/library.json), ou localStorage hors de Premiere (mode démo). */
(function (root) {
  'use strict';

  const nodeRequire = (() => {
    try {
      if (root.cep_node && root.cep_node.require) return root.cep_node.require;
      if (typeof root.require === 'function') return root.require;
    } catch (e) { /* no node */ }
    return null;
  })();

  let fs = null, path = null, os = null;
  if (nodeRequire) {
    try { fs = nodeRequire('fs'); path = nodeRequire('path'); os = nodeRequire('os'); } catch (e) { fs = null; }
  }

  const DIR = fs ? path.join(os.homedir(), 'Documents', 'RRFX') : null;
  const FILE = DIR ? path.join(DIR, 'library.json') : null;
  const LS_KEY = 'rrfx.library';

  const empty = () => ({ version: 1, favorites: [], items: [], history: [], settings: {} });

  function normalize(lib) {
    const out = Object.assign(empty(), lib && typeof lib === 'object' ? lib : {});
    if (!Array.isArray(out.items)) out.items = [];
    out.items = out.items.filter(i => i && typeof i === 'object' && i.data && typeof i.name === 'string');
    if (!Array.isArray(out.favorites)) out.favorites = [];
    if (!Array.isArray(out.history)) out.history = [];
    if (!out.settings || typeof out.settings !== 'object') out.settings = {};
    return out;
  }

  // Ancien nom du plugin : la bibliothèque de CutFX est reprise une fois.
  function migrate() {
    try {
      const old = path.join(os.homedir(), 'Documents', 'CutFX', 'library.json');
      if (!fs.existsSync(FILE) && fs.existsSync(old)) {
        fs.mkdirSync(DIR, { recursive: true });
        fs.copyFileSync(old, FILE);
      }
    } catch (e) { /* rien à reprendre */ }
  }

  function load() {
    if (fs) {
      migrate();
      if (!fs.existsSync(FILE)) return empty();
      const text = fs.readFileSync(FILE, 'utf8');
      try {
        return normalize(JSON.parse(text));
      } catch (e) {
        // Keep the unreadable file instead of overwriting the user's work.
        fs.renameSync(FILE, path.join(DIR, 'library.unreadable-' + Date.now() + '.json'));
        return empty();
      }
    }
    try {
      const s = root.localStorage.getItem(LS_KEY);
      return s ? normalize(JSON.parse(s)) : empty();
    } catch (e) {
      return empty();
    }
  }

  function save(lib) {
    const text = JSON.stringify(lib, null, 1);
    if (fs) {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, FILE);
      return;
    }
    try { root.localStorage.setItem(LS_KEY, text); } catch (e) { /* private mode */ }
  }

  const cepFs = () => (root.cep && root.cep.fs) || null;

  function exportJSON(data, defaultName) {
    const text = JSON.stringify(data, null, 1);
    const c = cepFs();
    if (fs && c && c.showSaveDialogEx) {
      const r = c.showSaveDialogEx('Exporter des effets RR FX', DIR || '', ['json'], defaultName);
      if (!r || r.err || !r.data) return null;
      const target = /\.json$/i.test(r.data) ? r.data : r.data + '.json';
      fs.writeFileSync(target, text, 'utf8');
      return target;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return defaultName;
  }

  // Enregistre un texte (LUT, DCTL…) via la boîte « Enregistrer sous » ; hors de Premiere, téléchargement.
  function exportText(text, defaultName, exts, title) {
    const c = cepFs();
    if (fs && c && c.showSaveDialogEx) {
      const r = c.showSaveDialogEx(title || 'Exporter', DIR || '', exts, defaultName);
      if (!r || r.err || !r.data) return null;
      const ext = '.' + exts[0], target = r.data.toLowerCase().endsWith(ext) ? r.data : r.data + ext;
      fs.writeFileSync(target, text, 'utf8');
      return target;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return defaultName;
  }

  // Fichier binaire écrit morceau par morceau (gros packs : pas tout en mémoire). → chemin, ou null.
  function saveBinary(chunks, defaultName, ext, title) {
    const c = cepFs();
    if (fs && c && c.showSaveDialogEx) {
      const r = c.showSaveDialogEx(title || 'Enregistrer', DIR || '', [ext], defaultName);
      if (!r || r.err || !r.data) return null;
      const target = r.data.toLowerCase().endsWith('.' + ext) ? r.data : r.data + '.' + ext;
      const fd = fs.openSync(target, 'w');
      try { for (const part of chunks) fs.writeSync(fd, Buffer.from(part.buffer, part.byteOffset, part.byteLength)); } finally { fs.closeSync(fd); }
      return target;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(Array.from(chunks), { type: 'application/zip' }));
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return defaultName;
  }

  function importJSON() {
    const c = cepFs();
    if (fs && c && c.showOpenDialogEx) {
      const r = c.showOpenDialogEx(true, false, 'Importer des effets RR FX', DIR || '', ['json']);
      if (!r || r.err || !r.data || !r.data.length) return Promise.resolve([]);
      return Promise.resolve(r.data.map(p => JSON.parse(fs.readFileSync(p, 'utf8'))));
    }
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.multiple = true;
      input.onchange = () => Promise.all(Array.from(input.files).map(f => f.text().then(t => JSON.parse(t)))).then(resolve, () => resolve([]));
      input.click();
    });
  }

  function openFolder() {
    if (!fs) return false;
    fs.mkdirSync(DIR, { recursive: true });
    const cp = nodeRequire('child_process');
    if (isWin()) cp.exec('explorer "' + DIR + '"');
    else cp.exec('open "' + DIR + '"');
    return true;
  }

  // Dossier de travail (images d'aperçu…), créé au besoin.
  function cacheDir() {
    if (!fs) return null;
    const d = path.join(DIR, 'cache');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // Compression des codes de partage (zlib de Node), sinon null.
  const zip = (() => {
    if (!nodeRequire) return null;
    try {
      const z = nodeRequire('zlib');
      return { deflate: b => new Uint8Array(z.deflateRawSync(Buffer.from(b))), inflate: b => new Uint8Array(z.inflateRawSync(Buffer.from(b))) };
    } catch (e) { return null; }
  })();

  // Fichiers choisis par l'utilisateur (chemins), via la boîte de dialogue de CEP.
  function pickFiles(title, types, directory) {
    const c = cepFs();
    if (!fs || !c || !c.showOpenDialogEx) return null;
    const r = c.showOpenDialogEx(!directory, !!directory, title, DIR || '', directory ? [] : types);
    if (!r || r.err || !r.data) return [];
    return r.data;
  }

  // Tous les fichiers d'un dossier (récursif, limité) dont l'extension convient.
  function listFiles(dir, exts, max, depth) {
    if (!fs) return [];
    const out = [];
    const walk = (d, level) => {
      if (out.length >= max || level > depth) return;
      let names = [];
      try { names = fs.readdirSync(d); } catch (e) { return; }
      names.forEach(n => {
        if (out.length >= max || n[0] === '.') return;
        const full = path.join(d, n);
        let st;
        try { st = fs.statSync(full); } catch (e) { return; }
        if (st.isDirectory()) walk(full, level + 1);
        else if (exts.test(n)) out.push(full);
      });
    };
    walk(dir, 0);
    return out;
  }

  const platform = () => ((root.process && root.process.platform) || (typeof process !== 'undefined' && process.platform) || '');
  const isWin = () => platform() === 'win32';

  // Montre un fichier dans le Finder / l'Explorateur (sélectionné).
  function reveal(file) {
    if (!fs) return false;
    const cp = nodeRequire('child_process');
    if (isWin()) cp.execFile('explorer.exe', ['/select,', String(file).replace(/\//g, '\\')], () => {});
    else cp.execFile('open', ['-R', file], () => {});
    return true;
  }

  // Lance une commande (sans shell) ; résout avec { ok, out }.
  function execFile(cmd, args) {
    return new Promise(resolve => {
      if (!nodeRequire) return resolve({ ok: false, out: 'indisponible' });
      nodeRequire('child_process').execFile(cmd, args, (err, out, errOut) => resolve({ ok: !err, out: String(err ? errOut || err.message : out || '') }));
    });
  }

  // Dossiers où Premiere et le système cherchent les LUT et polices de l'utilisateur.
  function systemDirs() {
    if (!fs) return null;
    const home = os.homedir(), env = (root.process && root.process.env) || {};
    if (isWin()) {
      const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming'), local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      return { luts: path.join(appData, 'Adobe', 'Common', 'LUTs', 'Creative'), fonts: path.join(local, 'Microsoft', 'Windows', 'Fonts'), win: true };
    }
    return { luts: path.join(home, 'Library', 'Application Support', 'Adobe', 'Common', 'LUTs', 'Creative'), fonts: path.join(home, 'Library', 'Fonts'), win: false };
  }

  // Petit fichier JSON dans Documents/RRFX (index des ressources…).
  function readJSON(name) {
    if (!fs) return null;
    try { return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')); } catch (e) { return null; }
  }
  function writeJSON(name, data) {
    if (!fs) return;
    fs.mkdirSync(DIR, { recursive: true });
    const f = path.join(DIR, name), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, f);
  }

  root.RRFXStorage = {
    load, save, exportJSON, exportText, saveBinary, importJSON, openFolder, cacheDir, zip, pickFiles, listFiles,
    reveal, execFile, systemDirs, readJSON, writeJSON, isWin, nodeRequire,
    fs, path, os, dir: DIR, location: FILE || 'navigateur (localStorage)', onDisk: !!fs
  };
})(typeof self !== 'undefined' ? self : this);
