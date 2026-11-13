/* RR FX : outils gratuits et IA locale, installés en option (Réglages › Outils gratuits).
   Trouve chaque outil (réglage, dossier de RR FX, PATH, emplacements habituels), l'installe en un
   clic dans Documents/RRFX/Outils (téléchargement, décompression, paquet Python dans un
   environnement à part), télécharge ses modèles, et le lance avec suivi de l'avancement.
   Les autres modules passent par app.tools :
   - find(id) → chemin ou '' ; need(id, pourquoi) → chemin (propose d'installer, sinon s'arrête) ;
   - run(exe, args, o) → { out, err } ; work(nom) → dossier de travail ; audioOf(...) → WAV ;
   - ollama : ready(kind), chat(...), embed(...).
   Le catalogue (adresses, arguments) est dans libres.js. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Lb = root.RRFXLibres, L = root.RRFXLiens, { Store } = app;
    const { h, row, picker, section, checkbox } = app.UI;
    const proc = () => (root.process || {});
    // Hors de Premiere (mode démo) : présenté comme sur Windows.
    const P = () => Lb.plat(proc().platform || 'win32', proc().arch);
    const win = () => Store.isWin();
    const node = name => Store.nodeRequire(name);
    const exists = p => { try { return !!p && Store.fs.existsSync(p); } catch (e) { return false; } };
    const mkdir = d => { Store.fs.mkdirSync(d, { recursive: true }); return d; };

    const st = () => {
      const s = app.settings();
      if (!s.tools || typeof s.tools !== 'object') s.tools = {};
      if (!s.ollama || typeof s.ollama !== 'object') s.ollama = {};
      const d = { text: Lb.OLLAMA_MODELS.text[0].id, vision: Lb.OLLAMA_MODELS.vision[0].id, embed: Lb.OLLAMA_MODELS.embed[0].id };
      Object.keys(d).forEach(k => { if (!s.ollama[k]) s.ollama[k] = d[k]; });
      return s;
    };
    const base = () => mkdir(Store.path.join(Store.dir, 'Outils'));
    const toolDir = id => Store.path.join(base(), id);
    // Environnement Python partagé, ou à part (python-<nom>) pour un outil dont les paquets gênent les autres.
    const venvDir = name => Store.path.join(base(), name ? 'python-' + name : 'python');
    // Outil lancé par un script de RR FX : prêt quand son environnement a été préparé (fichier témoin).
    const marker = t => Store.path.join(venvDir(t.venv), 'rrfx-' + t.id + '.ok');
    // Une tâche RR FX peut être arrêtée : chaque attente le vérifie.
    // Chaque tâche a son avancement et son arrêt (main.js : plusieurs tâches à la fois).
    const stat = () => app.status;
    const ctl = () => app.S;
    const stopped = () => { if (ctl().cancel) throw new Error(_T('Arrêté')); };
    // Une erreur qui finit la tâche en avertissement (pas en échec).
    const warn = (title, detail) => Object.assign(new Error(detail || title), { result: { kind: 'warn', title, detail } });

    // ---------------------------------------------------------------- lancer une commande

    // PATH des commandes lancées : ffmpeg et l'environnement Python de RR FX en premier.
    let ffmpegDir = '';
    function env(extra) {
      const e = Object.assign({}, proc().env || {}, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, extra || {});
      const sep = win() ? ';' : ':', key = Object.keys(e).find(k => k.toUpperCase() === 'PATH') || 'PATH';
      const add = [ffmpegDir, exists(venvDir()) ? Lb.venv(venvDir(), win()).bin : ''].filter(Boolean);
      // Mac : Premiere ne voit pas le PATH du Terminal (Homebrew).
      if (!win()) add.push('/opt/homebrew/bin', '/usr/local/bin');
      e[key] = add.concat([e[key] || '']).filter(Boolean).join(sep);
      return e;
    }

    const lastLine = t => String(t || '').trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^\s*warnings?\.warn|^\s*$/.test(l)).pop() || '';

    /* Lance exe (sans shell) ; o : { cwd, env, label, progress(ligne) → 0..1 | null, onLine(ligne),
       input (texte envoyé), keep (garder la sortie complète), anyCode (pas d'échec si le code de
       sortie n'est pas 0) }. → { out, err, code }. */
    function run(exe, args, o) {
      const x = o || {};
      return new Promise((resolve, reject) => {
        let cp;
        try { cp = node('child_process').spawn(exe, args, { windowsHide: true, cwd: x.cwd, env: env(x.env) }); } catch (e) { return reject(e); }
        let out = '', err = '', buf = '';
        const onLine = l => {
          if (x.progress) { const p = x.progress(l); if (p !== null && p !== undefined) stat().progress(Math.round(p * 100), 100, x.label || ''); }
          if (x.onLine) x.onLine(l);
        };
        const feed = d => { buf += String(d); const lines = buf.split(/[\r\n]+/); buf = lines.pop(); lines.forEach(onLine); };
        cp.stdout.on('data', d => { if (x.keep || out.length < 4e6) out += d; feed(d); });
        cp.stderr.on('data', d => { err += d; if (err.length > 80000) err = err.slice(-40000); feed(d); });
        if (x.input !== undefined) cp.stdin.end(x.input);
        const c = ctl();
        c.onCancel = () => { try { cp.kill(); } catch (e) { /* déjà fini */ } };
        cp.on('error', e => {
          c.onCancel = null;
          reject(e && e.code === 'ENOENT' ? new Error(_T('Introuvable : ') + exe) : e);
        });
        cp.on('close', code => {
          c.onCancel = null;
          if (buf) onLine(buf);
          if (c.cancel) return reject(new Error(_T('Arrêté')));
          if (code === 0 || x.anyCode) resolve({ out, err, code });
          else reject(new Error(lastLine(err) || lastLine(out) || Store.path.basename(exe) + _T(' s\'est arrêté (code ') + code + ')'));
        });
      });
    }

    // Dossier de travail vide (Documents/RRFX/cache/outils/<nom>-<heure>), effacé par clean().
    function work(name) {
      return mkdir(Store.path.join(Store.cacheDir(), 'outils', String(name).replace(/[^\w-]+/g, '-') + '-' + Date.now().toString(36)));
    }
    // Node 12.3 (Premiere 2021) n'a ni fs.rmSync ni rmdirSync récursif (12.10) : suppression à la main.
    // Les liens symboliques sont retirés sans suivre leur cible.
    function rmTree(p) {
      const fs = Store.fs;
      let st;
      try { st = fs.lstatSync(p); } catch (e) { return; }
      if (st.isDirectory()) { fs.readdirSync(p).forEach(n => rmTree(Store.path.join(p, n))); fs.rmdirSync(p); } else fs.unlinkSync(p);
    }
    function clean(dir) {
      try { if (Store.fs.rmSync) Store.fs.rmSync(dir, { recursive: true, force: true }); else rmTree(dir); } catch (e) { /* pas grave */ }
    }
    // Fichiers d'un dossier, triés (images numérotées).
    const listDir = (dir, re) => { try { return Store.fs.readdirSync(dir).filter(n => !re || re.test(n)).sort().map(n => Store.path.join(dir, n)); } catch (e) { return []; } };
    // Pour les outils sans avancement : le nombre de fichiers écrits dans out, sur total.
    function watchCount(dir, total, label) {
      const t = setInterval(() => { const n = listDir(dir).length; if (total) stat().progress(Math.min(n, total), total, label); }, 700);
      return () => clearInterval(t);
    }

    // ---------------------------------------------------------------- téléchargements

    /* GET en https seulement, redirections comprises : ce qui est téléchargé ici est exécuté
       ensuite (outils, Python), une redirection vers http:// pourrait être modifiée en route.
       onErr reçoit aussi les erreurs des requêtes suivantes (redirections). */
    function getUrl(url, onRes, onErr, hops) {
      const n = hops || 0;
      if (!/^https:/i.test(url)) return onErr(Object.assign(new Error(_T('Adresse refusée (pas en https) : ') + url), { refused: true }));
      const req = node('https').get(url, { headers: { 'User-Agent': 'RRFX' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (n >= 8) return onErr(Object.assign(new Error(_T('Trop de redirections.')), { refused: true }));
          let next = '';
          try { next = new URL(res.headers.location, url).toString(); } catch (e) { return onErr(e); }
          return getUrl(next, onRes, onErr, n + 1);
        }
        onRes(res);
      });
      req.on('error', onErr);
      return req;
    }
    const noConnection = (url, e) => (e && e.refused ? e : new Error(_T('Pas de connexion à ') + new URL(url).host + ' (' + ((e && (e.code || e.message)) || '') + ')'));
    /* Fichier téléchargé au fil de l'eau (jusqu'à plusieurs Go), sans tout garder en mémoire.
       sha256 : empreinte attendue (PyPI), vérifiée avant de garder le fichier. Un téléchargement
       coupé, incomplet ou arrêté ne laisse rien (le .part est effacé). */
    function download(url, file, label, mb, sha256) {
      return new Promise((resolve, reject) => {
        const part = file + '.part', c = ctl();
        let done = false, out = null;
        const removePart = () => { try { Store.fs.unlinkSync(part); } catch (e) { /* pas encore écrit */ } };
        const fail = e => {
          if (done) return;
          done = true;
          c.onCancel = null;
          // Fichier encore ouvert : effacé une fois fermé (Windows).
          if (out && !out.destroyed) { out.once('close', removePart); out.destroy(); } else removePart();
          reject(e);
        };
        getUrl(url, res => {
          if (res.statusCode !== 200) { res.resume(); return fail(new Error(_T('Téléchargement refusé (') + res.statusCode + ') : ' + url)); }
          const announced = Number(res.headers['content-length']) || 0, total = announced || (mb || 0) * 1e6;
          const hash = sha256 ? node('crypto').createHash('sha256') : null;
          out = Store.fs.createWriteStream(part);
          let got = 0;
          c.onCancel = () => res.destroy(new Error(_T('Arrêté')));
          res.on('data', d => { got += d.length; if (hash) hash.update(d); if (total) stat().progress(Math.min(got, total), total, label + ' · ' + Lb.size(got / 1e6)); });
          // Connexion coupée en cours de route : Node peut quand même finir le fichier, il serait tronqué.
          res.on('aborted', () => fail(new Error(_T('Téléchargement interrompu : ') + new URL(url).host)));
          res.on('error', fail);
          out.on('error', fail);
          out.on('finish', () => {
            if (done) return;
            if (announced && got !== announced) return fail(new Error(_T('Téléchargement incomplet (') + Lb.size(got / 1e6) + ' / ' + Lb.size(announced / 1e6) + ') : ' + url));
            if (hash && hash.digest('hex') !== String(sha256).toLowerCase()) return fail(new Error(_T('Fichier refusé : son empreinte SHA-256 ne correspond pas à celle annoncée (') + Store.path.basename(file) + ').'));
            try { Store.fs.renameSync(part, file); } catch (e) { return fail(e); }
            done = true;
            c.onCancel = null;
            resolve(file);
          });
          res.pipe(out);
        }, e => fail(noConnection(url, e)));
      });
    }
    function getJSON(url) {
      return new Promise((resolve, reject) => {
        getUrl(url, res => {
          if (res.statusCode !== 200) { res.resume(); return reject(new Error(_T('Téléchargement refusé (') + res.statusCode + ') : ' + url)); }
          let t = '';
          res.setEncoding('utf8');
          res.on('data', d => { t += d; });
          res.on('aborted', () => reject(new Error(_T('Téléchargement interrompu : ') + new URL(url).host)));
          res.on('error', reject);
          res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { reject(new Error(_T('Réponse illisible de ') + url)); } });
        }, e => reject(noConnection(url, e)));
      });
    }
    // Décompression par tar (fourni avec Windows 10+ et macOS : .zip, .tar.gz, .tar.bz2, .whl).
    function extract(archive, dir) {
      const tar = win() ? Store.path.join((proc().env || {}).SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
      mkdir(dir);
      return run(tar, ['-xf', archive, '-C', dir], { label: _T('Décompression') });
    }
    /* Décompressé à part (même disque), puis déplacé dans dir seulement si tout s'est bien passé :
       une décompression arrêtée ou ratée ne laisse pas un outil (ou un modèle) à moitié là. */
    async function extractInto(archive, dir) {
      const stage = Store.path.join(base(), '.decompression-' + Date.now().toString(36));
      try {
        await extract(archive, stage);
        stopped();
        mkdir(dir);
        Store.fs.readdirSync(stage).forEach(n => {
          const to = Store.path.join(dir, n);
          if (exists(to)) { if (Store.fs.statSync(to).isDirectory()) clean(to); else Store.fs.unlinkSync(to); }
          Store.fs.renameSync(Store.path.join(stage, n), to);
        });
      } finally { clean(stage); }
    }
    // Mac : exécutables autorisés à se lancer.
    async function unlock(dir, files) {
      if (win()) return;
      (files || []).forEach(f => { try { Store.fs.chmodSync(f, 0o755); } catch (e) { /* fichier en lecture seule */ } });
      try { await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dir]); } catch (e) { /* pas de quarantaine */ }
    }

    // ---------------------------------------------------------------- trouver un outil

    async function which(name) {
      const r = await Store.execFile(win() ? 'where' : 'which', [name]);
      const first = r.ok ? String(r.out).split(/\r?\n/).map(s => s.trim()).find(Boolean) : '';
      return exists(first) ? first : '';
    }
    function extraPaths(id) {
      const e = proc().env || {}, home = (Store.os && Store.os.homedir()) || '';
      if (id === 'ollama') return win()
        ? [(e.LOCALAPPDATA || '') + '\\Programs\\Ollama\\ollama.exe']
        : ['/Applications/Ollama.app/Contents/Resources/ollama', home + '/Applications/Ollama.app/Contents/Resources/ollama'];
      return [];
    }
    const found = {};
    async function find(id) {
      if (!Store.fs) return '';
      const t = Lb.byId(id), x = st().tools[id] || {};
      if (!t) return '';
      // Outil indiqué à la main : ffmpeg doit quand même être dans le PATH des commandes lancées.
      if (exists(x.exe)) { if (id === 'ffmpeg') ffmpegDir = Store.path.dirname(x.exe); return x.exe; }
      if (found[id] && exists(found[id])) return found[id];
      if (t.script) {
        const py = Lb.venv(venvDir(t.venv), win()).python;
        return (found[id] = exists(py) && exists(marker(t)) ? py : '');
      }
      let exe = '';
      const d = toolDir(id);
      // ownExe (« main » de whisper.cpp) : un nom trop courant, accepté seulement dans le dossier de RR FX.
      if (exists(d)) exe = Lb.findExe(Store.listFiles(d, /./, 5000, 6), t.exe.concat(t.ownExe || []), win());
      if (!exe && exists(venvDir())) { const v = Lb.venv(venvDir(), win()); exe = t.exe.map(n => v.exe(n)).find(exists) || ''; }
      for (const n of t.exe) {
        if (exe) break;
        exe = await which(n) || L.candidates(n, proc().platform, proc().env).find(exists) || '';
      }
      if (!exe) exe = extraPaths(id).find(exists) || '';
      found[id] = exe;
      if (id === 'ffmpeg') ffmpegDir = exe ? Store.path.dirname(exe) : '';
      return exe;
    }
    const forget = id => { delete found[id]; };

    // ---------------------------------------------------------------- Python (paquets pip)

    async function findPython(min) {
      for (const c of Lb.pythonCandidates(proc().platform, proc().env)) {
        if (/[\\/]/.test(c.cmd) && !exists(c.cmd)) continue;
        const r = await Store.execFile(c.cmd, c.args.concat(['--version']));
        const v = Lb.pyVersion(r.out);
        if (v && Lb.atLeast(v, min)) return { cmd: c.cmd, args: c.args, v };
      }
      return null;
    }
    async function installPython() {
      const dir = toolDir('python312');
      if (win()) {
        stat().phase(_T('Installation de Python ') + Lb.PYTHON.version);
        const exe = Store.path.join(work('python'), 'python-setup.exe');
        await download(Lb.PYTHON.win, exe, 'Python', 26);
        await run(exe, Lb.PYTHON.winArgs(dir), { label: 'Python' });
        const py = Store.path.join(dir, 'python.exe');
        if (!exists(py)) throw new Error(_T('Python ne s\'est pas installé. Installe-le depuis python.org, puis réessaie.'));
        return { cmd: py, args: [] };
      }
      // Mac : l'installateur officiel s'ouvre (mot de passe demandé par macOS).
      const pkg = Store.path.join(work('python'), 'python.pkg');
      await download(Lb.PYTHON.mac, pkg, 'Python', 45);
      await run('/usr/bin/open', [pkg]);
      throw warn(_T('Installe Python puis relance'), _T('L\'installateur de Python vient de s\'ouvrir : suis-le jusqu\'au bout, puis relance l\'installation dans Réglages › Outils gratuits.'));
    }
    // L'environnement Python de RR FX (créé une fois), avec une version suffisante.
    async function ensureVenv(min, name) {
      const dir = venvDir(name), v = Lb.venv(dir, win()), need = min || [3, 10];
      if (exists(v.python)) {
        const r = await Store.execFile(v.python, ['--version']);
        if (Lb.atLeast(Lb.pyVersion(r.out), need)) return v;
        clean(dir);
      }
      const py = (await findPython(need)) || (await installPython());
      stat().phase(_T('Environnement Python de RR FX'));
      await run(py.cmd, py.args.concat(['-m', 'venv', dir]), { label: 'Python' });
      if (!exists(v.python)) throw new Error(_T('L\'environnement Python n\'a pas été créé (') + dir + ').');
      return v;
    }
    // pkg : un ou plusieurs paquets séparés par des espaces (« transformers>=4.56 torch »).
    async function pipInstall(pkg, name, min, venvName) {
      const v = await ensureVenv(min, venvName);
      stat().phase(_T('Installation de ') + name + _T(' (Python, peut prendre plusieurs minutes)'));
      await run(v.python, Lb.pipArgs(String(pkg).split(/\s+/).filter(Boolean)), {
        label: name,
        onLine: l => { const s = Lb.pipStep(l); if (s) stat().phase(name + ' · ' + (s.last ? _T('installation') : s.what + (s.size ? ' (' + s.size + ')' : ''))); }
      });
    }

    // ---------------------------------------------------------------- installer

    async function fetchModel(id, m) {
      const dir = mkdir(Store.path.join(toolDir(id), 'models')), target = Store.path.join(dir, m.file);
      if (exists(target)) return target;
      const name = m.url.replace(/^.*\//, '');
      if (m.extract) {
        const tmp = work('modele'), a = Store.path.join(tmp, name);
        try {
          await download(m.url, a, _T('Modèle'), m.mb);
          await extractInto(a, dir);
        } finally { clean(tmp); }
      } else await download(m.url, target, _T('Modèle'), m.mb);
      if (!exists(target)) throw new Error(_T('Modèle introuvable après téléchargement : ') + m.file);
      return target;
    }
    async function models(id) {
      const t = Lb.byId(id), out = {};
      for (const m of t.models || []) { stopped(); out[m.id] = await fetchModel(id, m); }
      return out;
    }

    async function installWith(t, how) {
      const dir = mkdir(toolDir(t.id));
      if (how.type === 'file') {
        const f = Store.path.join(dir, Lb.exeName(how.rename || how.url.replace(/^.*\//, ''), win()));
        await download(how.url, f, t.name, t.mb);
        await unlock(dir, [f]);
      } else if (how.type === 'archive') {
        const tmp = work(t.id), a = Store.path.join(tmp, how.url.replace(/^.*\//, ''));
        try {
          await download(how.url, a, t.name, t.mb);
          stopped();
          await extractInto(a, dir);
        } finally { clean(tmp); }
        const names = t.exe.concat(t.ownExe || []);
        await unlock(dir, Store.listFiles(dir, /./, 5000, 6).filter(f => names.indexOf(Store.path.basename(f)) >= 0));
      } else if (how.type === 'wheel') {
        stat().phase(t.name + _T(' : recherche de la dernière version'));
        const meta = await getJSON('https://pypi.org/pypi/' + how.pkg + '/json'), w = Lb.pickWheel(meta.urls, P());
        if (!w) throw new Error(t.name + _T(' : aucun paquet pour ce système.'));
        // Empreinte publiée par PyPI : le paquet téléchargé doit être exactement celui-là.
        const sha = w.digests && w.digests.sha256;
        if (!sha || !/^[0-9a-f]{64}$/i.test(sha)) throw new Error(t.name + _T(' : empreinte du paquet absente sur PyPI, installation refusée.'));
        const tmp = work(t.id), a = Store.path.join(tmp, w.filename);
        try {
          await download(w.url, a, t.name, (w.size || 0) / 1e6, sha);
          const x = mkdir(Store.path.join(tmp, 'x'));
          await extract(a, x);
          stopped();
          const re = new RegExp(how.member), files = Store.listFiles(x, /./, 20000, 8);
          const member = files.find(f => re.test(Store.path.relative(x, f).split(Store.path.sep).join('/')));
          if (!member) throw new Error(t.name + _T(' : exécutable absent du paquet ') + w.filename);
          const f = Store.path.join(dir, how.rename ? Lb.exeName(how.rename, win()) : Store.path.basename(member));
          Store.fs.copyFileSync(member, f);
          await unlock(dir, [f]);
        } finally { clean(tmp); }
      } else if (how.type === 'pip') {
        await pipInstall(how.pkg, t.name, t.minPy, t.venv);
        if (t.script) Store.fs.writeFileSync(marker(t), how.pkg + '\n' + new Date().toISOString() + '\n');
      } else if (how.type === 'brew') {
        const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(exists);
        if (!brew) {
          if (how.fallback) return installWith(t, how.fallback);
          throw new Error(_T('Homebrew est nécessaire (brew.sh), ou installe ') + t.name + _T(' toi-même.'));
        }
        stat().phase(_T('Installation de ') + t.name + ' (Homebrew)');
        await run(brew, ['install', how.formula], { label: t.name, env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' } });
      }
      return null;
    }

    // Installe l'outil (dans une tâche déjà lancée). → chemin de l'exécutable.
    async function installCore(id) {
      if (!Store.fs) throw warn(_T('Disponible dans Premiere'), _T('Les outils s\'installent depuis Premiere.'));
      const t = Lb.byId(id), how = Lb.howFor(t, P());
      if (!how) throw new Error(t.name + _T(' ne s\'installe pas tout seul sur ce système : ') + t.site);
      stat().phase(_T('Installation de ') + t.name);
      await installWith(t, how);
      stopped();
      if (t.models) await models(id);
      forget(id);
      const exe = await find(id);
      if (!exe) throw new Error(t.name + _T(' installé, mais introuvable ensuite dans ') + toolDir(id));
      app.log(t.name + _T(' installé : ') + exe, 'ok');
      if (id === 'ollama') await ollamaStart();
      return exe;
    }
    // Installation, désinstallation : des tâches comme les autres, qui ne bloquent rien.
    const runBg = (label, fn) => app.runTask(label, fn, true).then(r => { refreshSection(); return r; });

    const install = id => runBg(_T('Installation de ') + Lb.byId(id).name, async () => {
      const exe = await installCore(id);
      return { kind: 'ok', title: Lb.byId(id).name + _T(' est prêt'), detail: exe };
    });

    // Désinstaller ce que RR FX a installé (dans Documents/RRFX/Outils) : son dossier, ses paquets
    // Python (ou tout son environnement s'il en a un à lui). Les modèles d'Ollama (~/.ollama) restent.
    const ours = p => { try { return !!p && Store.path.resolve(p).indexOf(Store.path.resolve(base()) + Store.path.sep) === 0; } catch (e) { return false; } };
    async function uninstallCore(id) {
      const t = Lb.byId(id), how = Lb.howFor(t, P());
      if (st().tools[id]) { delete st().tools[id]; app.persist(); }
      if (id === 'ollama') {
        // Ollama lancé par RR FX : arrêté d'abord, sinon ses fichiers restent verrouillés (Windows).
        try { await (win() ? Store.execFile('taskkill', ['/IM', 'ollama.exe', '/F']) : Store.execFile('pkill', ['-x', 'ollama'])); } catch (e) { /* pas lancé */ }
      }
      // Paquets Python : d'après l'endroit où l'outil est vraiment (Whisper sur Mac : Homebrew, ou
      // pip en secours dans l'environnement de RR FX), pas d'après la façon d'installer prévue.
      const pipHow = [how, how && how.fallback].find(w => w && w.type === 'pip');
      const exe = pipHow ? await find(id).catch(() => '') : '';
      const vroot = Store.path.resolve(venvDir(t.venv)) + Store.path.sep;
      const inVenv = !!exe && Store.path.resolve(exe).indexOf(vroot) === 0;
      if (pipHow && (t.script || inVenv)) {
        if (t.venv) clean(venvDir(t.venv));
        else {
          const v = Lb.venv(venvDir(), win());
          // t.uninstall : seulement ses paquets à lui (l'environnement est partagé avec d'autres outils).
          const pkgs = t.uninstall !== undefined ? t.uninstall : pipHow.pkg;
          if (pkgs && exists(v.python)) { stat().phase(_T('Désinstallation de ') + t.name); await run(v.python, Lb.pipUninstallArgs(pkgs), { label: t.name }); }
          if (t.script) { try { Store.fs.unlinkSync(marker(t)); } catch (e) { /* déjà retiré */ } }
        }
      }
      clean(toolDir(id));
      forget(id);
      delete state[id];
      if (exists(toolDir(id))) throw new Error(t.name + _T(' : des fichiers sont encore utilisés. Ferme ce qui l\'utilise, puis recommence.'));
      app.log(t.name + _T(' désinstallé'), 'ok');
    }
    async function uninstall(id) {
      const t = Lb.byId(id);
      const go = await app.confirmDialog(_T('Désinstaller ') + t.name + ' ?', _T('Ses fichiers sont supprimés de Documents/RRFX/Outils') + _T('. Tu pourras le réinstaller à tout moment.') + (id === 'ollama' ? _T(' Les modèles restent dans le dossier .ollama de ton compte : supprime-le pour récupérer leur place.') : ''), _T('Désinstaller'));
      if (!go) return;
      await runBg(_T('Désinstallation de ') + t.name, async () => {
        await uninstallCore(id);
        return { kind: 'ok', title: t.name + _T(' désinstallé'), detail: '' };
      });
      await check(id).catch(() => null);
      refreshSection();
    }

    // Dans une tâche : l'outil, ou la proposition de l'installer tout de suite.
    async function need(id, why) {
      const exe = await find(id);
      if (exe) return exe;
      const t = Lb.byId(id);
      if (!Store.fs) throw warn(_T('Disponible dans Premiere'), t.name + _T(' s\'installe et se lance depuis Premiere.'));
      const how = Lb.howFor(t, P());
      const body = h('div', null,
        h('p', null, t.name + _T(' n\'est pas encore installé. ') + _T(t.what)),
        why ? h('p', null, why) : null,
        h('p', { class: 'note' }, _T('Gratuit, installé dans Documents/RRFX/Outils · ') + Lb.size(t.mb) + (how && how.type === 'pip' ? _T(' (avec Python)') : '') + _T(' · licence ') + t.license));
      const v = await app.modal(_T('Installer ') + t.name + ' ?', body, [{ label: _T('Plus tard'), value: null }, { label: _T('Installer maintenant'), primary: true, value: 'go' }]);
      if (v !== 'go') throw warn(t.name + _T(' n\'est pas installé'), _T('Installe-le quand tu veux dans Réglages › Outils gratuits.'));
      const exe2 = await installCore(id);
      refreshSection();
      return exe2;
    }

    // ---------------------------------------------------------------- scripts Python de RR FX

    /* Lance un script de pyscripts.js avec l'environnement de l'outil id (installé au besoin).
       Le script est écrit dans le dossier de travail dir. → { out, err } */
    async function runPy(id, script, args, o) {
      const py = await need(id, (o && o.why) || '');
      const dir = (o && o.dir) || work('script'), file = Store.path.join(dir, script);
      Store.fs.writeFileSync(file, root.RRFXPy.SCRIPTS[script], 'utf8');
      return run(py, [file].concat(args), Object.assign({
        // Hugging Face : pas d'alerte sur les liens symboliques (Windows) ; torch récent : anciens poids lisibles.
        env: { HF_HUB_DISABLE_SYMLINKS_WARNING: '1', TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1', TOKENIZERS_PARALLELISM: 'false' },
        progress: root.RRFXPy.progress
      }, o || {}));
    }

    // ---------------------------------------------------------------- ffmpeg

    // Son d'un média en WAV (mono 16 kHz par défaut), extrait [start, start + dur] s.
    async function audioOf(input, o) {
      const x = o || {}, ff = await need('ffmpeg', _T('ffmpeg lit le son de ce fichier.'));
      const out = x.out || Store.path.join(work('son'), 'son.wav');
      await run(ff, Lb.ffAudio(input, out, x), { label: _T('Lecture du son'), progress: l => Lb.ffProgress(l, x.dur) });
      return out;
    }
    // Durée et cadence d'un média (ffmpeg -i).
    async function probe(input) {
      const ff = await need('ffmpeg');
      // ffmpeg sans fichier de sortie s'arrête en erreur, après avoir décrit le média.
      const r = await run(ff, ['-hide_banner', '-i', input], { anyCode: true });
      return Lb.ffProbe(r.err);
    }

    // ---------------------------------------------------------------- Ollama

    const OLLAMA = 'http://127.0.0.1:11434';
    // Requête à Ollama ; onLine : réponse en flux (une ligne JSON par morceau).
    function ollamaCall(method, pathname, body, onLine, timeout) {
      return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = node('http').request(OLLAMA + pathname, { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
          let text = '', buf = '';
          res.setEncoding('utf8');
          res.on('data', d => {
            if (!onLine) { text += d; return; }
            buf += d;
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(l => { if (l.trim()) { try { onLine(JSON.parse(l)); } catch (e) { /* ligne incomplète */ } } });
          });
          res.on('end', () => {
            if (res.statusCode >= 400) {
              let msg = text;
              try { msg = JSON.parse(text).error || text; } catch (e) { /* texte brut */ }
              return reject(new Error('Ollama : ' + (msg || res.statusCode)));
            }
            if (onLine) return resolve(null);
            try { resolve(text ? JSON.parse(text) : null); } catch (e) { resolve(text); }
          });
        });
        req.on('error', reject);
        if (timeout) req.setTimeout(timeout, () => req.destroy(new Error(_T('Ollama ne répond pas'))));
        ctl().onCancel = () => req.destroy(new Error(_T('Arrêté')));
        if (data) req.write(data);
        req.end();
      });
    }
    const ollamaUp = () => ollamaCall('GET', '/api/version', null, null, 2500).then(() => true, () => false);
    async function ollamaStart() {
      if (await ollamaUp()) return true;
      const exe = await find('ollama');
      if (!exe) return false;
      try {
        const cp = node('child_process').spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: env() });
        cp.unref();
      } catch (e) { return false; }
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await ollamaUp()) return true;
      }
      return false;
    }
    async function ollamaModels() {
      const r = await ollamaCall('GET', '/api/tags', null, null, 5000);
      return ((r && r.models) || []).map(m => m.name);
    }
    const hasModel = (list, id) => list.some(n => n === id || n === id + ':latest' || n.split(':')[0] === id && id.indexOf(':') < 0);
    async function pull(model) {
      stat().phase(_T('Téléchargement du modèle ') + model);
      let failed = '';
      await ollamaCall('POST', '/api/pull', { model, stream: true }, m => {
        if (m.error) failed = m.error;
        else if (m.total) stat().progress(m.completed || 0, m.total, model + ' · ' + Lb.size((m.completed || 0) / 1e6) + ' / ' + Lb.size(m.total / 1e6));
        else if (m.status) stat().phase(model + ' · ' + m.status);
      });
      if (failed) throw new Error('Ollama : ' + failed);
    }
    /* Ollama lancé et le modèle voulu (kind : text, vision, embed) présent, téléchargé au besoin
       après accord. → nom du modèle. */
    async function ready(kind, why) {
      await need('ollama', why);
      if (!(await ollamaStart())) throw new Error(_T('Ollama ne démarre pas. Ouvre l\'application Ollama, puis réessaie.'));
      const model = st().ollama[kind || 'text'];
      if (!hasModel(await ollamaModels(), model)) {
        const m = (Lb.OLLAMA_MODELS[kind || 'text'] || []).find(q => q.id === model);
        const v = await app.modal(_T('Télécharger le modèle ') + model + ' ?', h('div', null,
          h('p', null, _T('Ollama a besoin de ce modèle pour cette fonction (une seule fois') + (m ? ', ' + String(m.gb).replace('.', ',') + ' Go' : '') + ').'),
          h('p', { class: 'note' }, _T('Il reste sur ton ordinateur ; tu peux en choisir un autre dans Réglages › Outils gratuits.'))),
        [{ label: _T('Plus tard'), value: null }, { label: _T('Télécharger'), primary: true, value: 'go' }]);
        if (v !== 'go') throw warn(_T('Modèle non téléchargé'), _T('Choisis et télécharge un modèle dans Réglages › Outils gratuits.'));
        await pull(model);
      }
      return model;
    }
    /* Une réponse d'Ollama. messages : [{ role, content, images? (base64) }] ; o.format : schéma
       JSON attendu (la réponse est alors lue en JSON). */
    async function chat(model, messages, o) {
      const x = o || {};
      const r = await ollamaCall('POST', '/api/chat', {
        model, messages, stream: false, keep_alive: '10m', format: x.format,
        options: { temperature: x.temperature === undefined ? 0.2 : x.temperature, num_ctx: x.ctx || 8192 }
      }, null, x.timeout || 600000);
      const text = (r && r.message && r.message.content) || '';
      if (!x.format) return text.trim();
      try { return JSON.parse(text); } catch (e) {
        const m = /\{[\s\S]*\}/.exec(text);
        if (m) try { return JSON.parse(m[0]); } catch (e2) { /* plus bas */ }
        throw Object.assign(new Error(_T('Réponse de l\'IA illisible')), { unreadable: true });
      }
    }
    async function embed(model, input) {
      const r = await ollamaCall('POST', '/api/embed', { model, input, keep_alive: '10m' }, null, 600000);
      return (r && r.embeddings) || [];
    }

    // ---------------------------------------------------------------- Réglages › Outils gratuits

    let sectionBox = null, scanned = 0;
    const state = {};
    async function check(id) {
      const exe = await find(id);
      const t = Lb.byId(id), s = { exe, models: true };
      if (exe && t.models) s.models = t.models.every(m => exists(Store.path.join(toolDir(id), 'models', m.file)));
      if (id === 'ollama') {
        s.up = await ollamaUp();
        s.list = s.up ? await ollamaModels().catch(() => []) : [];
      }
      state[id] = s;
      return s;
    }
    function refreshSection() { if (sectionBox && sectionBox.isConnected) fill(sectionBox); }

    function card(t) {
      const s = state[t.id], how = Lb.howFor(t, P());
      const ok = s && s.exe && s.models;
      const pill = h('span', { class: 'badge tool-state' + (ok ? ' ok' : '') }, !s ? (Store.fs ? '…' : _T('non installé')) : ok ? _T('✓ installé') : s.exe ? _T('modèles à télécharger') : _T('non installé'));
      const btns = h('div', { class: 'row-buttons wrap' });
      if (!ok) {
        const b = h('button', { class: 'action go', disabled: !Store.fs || !how }, (s && s.exe ? _T('Télécharger les modèles') : _T('Installer')) + ' (' + Lb.size(t.mb) + ')');
        b.addEventListener('click', () => install(t.id));
        btns.appendChild(b);
      }
      if (s && s.exe && ours(s.exe)) {
        const un = h('button', { class: 'action quiet danger' }, _T('Désinstaller'));
        un.addEventListener('click', () => uninstall(t.id));
        btns.appendChild(un);
      }
      const pick = h('button', { class: 'action quiet', disabled: !Store.fs }, _T('Indiquer l\'outil…'));
      pick.addEventListener('click', () => {
        const f = Store.pickFiles(_T('Où est ') + t.name + ' ?', []);
        if (f && f[0]) { st().tools[t.id] = { exe: f[0] }; app.persist(); forget(t.id); check(t.id).then(refreshSection); }
      });
      const site = h('button', { class: 'action quiet' }, _T('Site'));
      site.addEventListener('click', () => app.Host.openURL(t.site));
      btns.append(pick, site);
      if (s && s.exe && exists(toolDir(t.id))) {
        const open = h('button', { class: 'action quiet' }, _T('Dossier'));
        open.addEventListener('click', () => Store.reveal(s.exe));
        btns.appendChild(open);
      }
      const tick = !ok && how ? checkbox('', picked.has(t.id), v => { if (v) picked.add(t.id); else picked.delete(t.id); refreshSection(); }) : null;
      if (tick) { tick.classList.add('tool-pick'); tick.title = _T('À installer avec « Installer la sélection »'); }
      const kids = [
        h('div', { class: 'tool-head' }, tick, h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, t.icon), h('strong', null, t.name), pill),
        h('div', { class: 'note' }, _T(t.what)),
        h('div', { class: 'note tool-uses' }, t.uses.map(u => _T(u)).join(' · ')),
        h('div', { class: 'note' }, Lb.size(t.mb) + _T(' · licence ') + t.license + (how && how.type === 'pip' ? _T(' · s\'installe avec Python (fait par RR FX)') : '') + (!how ? _T(' · à installer soi-même sur ce système') : '') + (s && s.exe ? ' · ' + s.exe : ''))
      ];
      if (t.id === 'ollama') kids.push(ollamaBox(s));
      kids.push(btns);
      return h('div', { class: 'tool-card' + (ok ? ' ok' : '') }, kids);
    }

    function ollamaBox(s) {
      const o = st().ollama, box = h('div', { class: 'tool-models' });
      const labels = { text: _T('Texte'), vision: _T('Images'), embed: _T('Recherche') };
      Object.keys(labels).forEach(kind => {
        const have = s && s.list ? hasModel(s.list, o[kind]) : false;
        box.appendChild(row(labels[kind], h('div', { class: 'tool-model' },
          picker(Lb.OLLAMA_MODELS[kind].map(m => ({ v: m.id, label: _T(m.label) })), o[kind], v => { o[kind] = v; app.persist(); refreshSection(); }),
          h('span', { class: 'note' }, !s || !s.up ? '' : have ? _T('✓ prêt') : _T('à télécharger')))));
      });
      if (s && s.exe && !s.up) box.appendChild(h('div', { class: 'note' }, _T('Ollama est installé mais pas lancé : RR FX le démarre quand il en a besoin.')));
      if (s && s.up) {
        const missing = Object.keys(labels).map(k => o[k]).filter(m => !hasModel(s.list, m));
        if (missing.length) {
          const b = h('button', { class: 'action' }, _T('Télécharger les modèles choisis'));
          b.addEventListener('click', () => runBg(_T('Modèles Ollama'), async () => {
            for (const m of missing) { stopped(); await pull(m); }
            return { kind: 'ok', title: app.plural(missing.length, _T('modèle prêt'), _T('modèles prêts')), detail: missing.join(', ') };
          }).then(() => check('ollama')).then(refreshSection));
          box.appendChild(h('div', { class: 'row-buttons' }, b));
        }
      }
      return box;
    }

    // Installer les outils cochés : l'un après l'autre, puis les modèles Ollama choisis. Un échec
    // n'arrête pas la suite ; le bilan dit ce qui n'a pas pu s'installer.
    const missingTools = () => Lb.TOOLS.filter(t => Lb.howFor(t, P()) && !(state[t.id] && state[t.id].exe && state[t.id].models));
    const picked = new Set();
    const sizeOf = list => Lb.size(list.reduce((a, t) => a + (t.mb || 0), 0));
    async function installAll(direct) {
      // État à jour d'abord : un outil déjà là n'est pas réinstallé.
      await Promise.all(Lb.TOOLS.map(t => (state[t.id] ? null : check(t.id).catch(() => null))));
      const todo = missingTools().filter(t => picked.has(t.id));
      if (!todo.length) return app.status.finish('warn', _T('Aucun outil coché'), _T('Coche les outils à installer (ou « Tout cocher »).'));
      const mb = todo.reduce((a, t) => a + (t.mb || 0), 0);
      const go = direct || await app.confirmDialog(todo.length > 1 ? _T('Installer ces outils ?') : _T('Installer cet outil ?'),
        todo.map(t => t.name).join(', ') + _T(' : environ ') + Lb.size(mb) + _T(' à télécharger. Ça peut prendre un moment ; tu peux continuer à monter pendant ce temps, et Arrêter à tout moment.'),
        _T('Installer'));
      if (!go) return;
      await runBg(_T('Installation des outils'), async () => {
        const done = [], failed = [];
        for (let i = 0; i < todo.length; i++) {
          stopped();
          stat().progress(i, todo.length, todo[i].name);
          try { await installCore(todo[i].id); done.push(todo[i].name); } catch (e) {
            if (ctl().cancel) throw e;
            failed.push(todo[i].name + ' (' + app.errorMessage(e) + ')');
            app.log(todo[i].name + ' : ' + app.errorMessage(e), 'warn');
          }
          forget(todo[i].id);
        }
        // Modèles Ollama choisis (texte, images, recherche), si Ollama est là.
        if (todo.some(t => t.id === 'ollama') && done.indexOf(Lb.byId('ollama').name) >= 0) {
          try {
            const o = st().ollama, have = await ollamaModels();
            for (const m of [o.text, o.vision, o.embed].filter((m, i, a) => m && a.indexOf(m) === i && !hasModel(have, m))) { stopped(); await pull(m); }
          } catch (e) { if (ctl().cancel) throw e; failed.push(_T('modèles Ollama (') + app.errorMessage(e) + ')'); }
        }
        stat().progress(todo.length, todo.length, '');
        todo.forEach(t => picked.delete(t.id));
        if (!failed.length) return { kind: 'ok', title: app.plural(done.length, _T('outil installé'), _T('outils installés')), detail: done.join(', ') };
        return { kind: 'warn', title: app.plural(done.length, _T('outil installé'), _T('outils installés')) + ', ' + app.plural(failed.length, _T('échec'), _T('échecs')), detail: failed.join(' · ') };
      });
      await Promise.all(Lb.TOOLS.map(t => check(t.id).catch(() => null)));
      refreshSection();
    }

    function fill(box) {
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'note' }, _T('Des outils gratuits et open source qui tournent sur ton ordinateur : rien n\'est envoyé en ligne. Chacun est optionnel ; RR FX propose aussi de l\'installer au moment où une fonction en a besoin. Tout va dans Documents/RRFX/Outils.')));
      box.appendChild(h('div', { class: 'note' }, _T('Intégré, rien à installer : la détection de la voix (Silero) pour couper les silences, et la détection des visages (YuNet).')));
      // Cases à cocher sur les outils manquants, « Tout cocher », puis « Installer la sélection ».
      const todo = missingTools();
      if (todo.length) {
        const sel = todo.filter(t => picked.has(t.id)), every = sel.length === todo.length;
        const all = h('button', { class: 'action' }, every ? _T('Tout décocher') : _T('Tout cocher'));
        all.addEventListener('click', () => { todo.forEach(t => (every ? picked.delete(t.id) : picked.add(t.id))); refreshSection(); });
        const go = h('button', { class: 'action go tools-go', disabled: !Store.fs || !sel.length },
          sel.length ? _T('Installer la sélection') + ' (' + sel.length + ' · ' + sizeOf(sel) + ')' : _T('Coche les outils à installer'));
        go.addEventListener('click', installAll);
        box.appendChild(h('div', { class: 'row-buttons tools-bar' }, all, go));
      }
      Lb.TOOLS.forEach(t => box.appendChild(card(t)));
    }

    function toolsSection() {
      const box = h('div', { class: 'tools-list' });
      sectionBox = box;
      fill(box);
      const again = h('button', { class: 'action quiet' }, _T('Vérifier à nouveau'));
      const scan = () => { scanned = Date.now(); return Promise.all(Lb.TOOLS.map(t => { forget(t.id); return check(t.id).catch(() => null); })).then(refreshSection); };
      again.addEventListener('click', scan);
      // L'état est gardé une minute : ouvrir les Réglages ne relance pas toutes les recherches.
      if (Store.fs && Date.now() - scanned > 60000) scan();
      const el = section(_T('Outils gratuits et IA locale'), box, again);
      el.dataset.sec = 'outils';
      return el;
    }
    app.settingsExtras.push(toolsSection);

    // Premier lancement (une fois) : proposer d'équiper RR FX de tous ses outils gratuits.
    async function offer() {
      const s = app.settings();
      if (s.toolsOffered || !Store.fs) return;
      s.toolsOffered = true;
      app.persist();
      await Promise.all(Lb.TOOLS.map(t => check(t.id).catch(() => null)));
      const todo = missingTools();
      if (!todo.length) return;
      todo.forEach(t => picked.add(t.id));
      const total = h('div', { class: 'note offer-total' });
      const upd = () => { const sel = todo.filter(t => picked.has(t.id)); total.textContent = sel.length ? app.plural(sel.length, _T('outil coché'), _T('outils cochés')) + _T(' · environ ') + sizeOf(sel) + _T(' à télécharger') : _T('Aucun outil coché'); };
      const list = h('div', { class: 'offer-list' }, todo.map(t => h('div', { class: 'offer-item' },
        checkbox(t.icon + ' ' + t.name, true, v => { if (v) picked.add(t.id); else picked.delete(t.id); upd(); }),
        h('div', { class: 'note' }, _T(t.what)))));
      upd();
      const v = await app.modal(_T('Équipe RR FX'), h('div', { class: 'wl' },
        h('div', { class: 'wl-lead' }, _T('RR FX fonctionne mieux quand il est bien équipé : transcription, voix propre, pistes séparées, IA pour les titres et la recherche, détourage… Ces outils sont gratuits, tournent sur ton ordinateur et ne sont installés qu\'une fois.')),
        h('div', { class: 'note' }, _T('Tu peux continuer à monter pendant l\'installation. Décoche ceux dont tu n\'as pas besoin ; tout se retrouve dans Réglages › Outils gratuits.')),
        list, total), [{ label: _T('Plus tard'), value: null }, { label: _T('Installer la sélection'), primary: true, value: 'go' }]);
      if (v !== 'go') { picked.clear(); app.log(_T('Outils gratuits : à installer plus tard dans Réglages › Outils gratuits.'), 'info'); return; }
      await installAll(true);
    }

    app.tools = {
      offer, find, need, install, installCore, run, runPy, work, clean, listDir, watchCount, download, models, fetchModel, audioOf, probe, toolDir,
      voice: async v => {
        const dir = mkdir(Store.path.join(toolDir('piper'), 'voices')), onnx = Store.path.join(dir, v.id + '.onnx');
        if (!exists(onnx)) {
          await download(Lb.HF(v.path + '.onnx.json'), onnx + '.json', _T('Voix ') + v.label, 0.01);
          await download(Lb.HF(v.path + '.onnx'), onnx, _T('Voix ') + v.label, v.mb);
        }
        return onnx;
      },
      ollama: { ready, chat, embed, up: ollamaUp, start: ollamaStart, models: ollamaModels, pull, settings: () => st().ollama },
      warn
    };
  });
})(typeof self !== 'undefined' ? self : this);
