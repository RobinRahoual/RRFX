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
    const { h, row, picker, section } = app.UI;
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
    const stopped = () => { if (app.S.cancel) throw new Error(_T('Arrêté')); };
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
          if (x.progress) { const p = x.progress(l); if (p !== null && p !== undefined) app.status.progress(Math.round(p * 100), 100, x.label || ''); }
          if (x.onLine) x.onLine(l);
        };
        const feed = d => { buf += String(d); const lines = buf.split(/[\r\n]+/); buf = lines.pop(); lines.forEach(onLine); };
        cp.stdout.on('data', d => { if (x.keep || out.length < 4e6) out += d; feed(d); });
        cp.stderr.on('data', d => { err += d; if (err.length > 80000) err = err.slice(-40000); feed(d); });
        if (x.input !== undefined) cp.stdin.end(x.input);
        app.S.onCancel = () => { try { cp.kill(); } catch (e) { /* déjà fini */ } };
        cp.on('error', e => {
          app.S.onCancel = null;
          reject(e && e.code === 'ENOENT' ? new Error(_T('Introuvable : ') + exe) : e);
        });
        cp.on('close', code => {
          app.S.onCancel = null;
          if (buf) onLine(buf);
          if (app.S.cancel) return reject(new Error(_T('Arrêté')));
          if (code === 0 || x.anyCode) resolve({ out, err, code });
          else reject(new Error(lastLine(err) || lastLine(out) || Store.path.basename(exe) + _T(' s\'est arrêté (code ') + code + ')'));
        });
      });
    }

    // Dossier de travail vide (Documents/RRFX/cache/outils/<nom>-<heure>), effacé par clean().
    function work(name) {
      return mkdir(Store.path.join(Store.cacheDir(), 'outils', String(name).replace(/[^\w-]+/g, '-') + '-' + Date.now().toString(36)));
    }
    // Node 12 (Premiere 2021) n'a pas encore fs.rmSync.
    function clean(dir) {
      try { if (Store.fs.rmSync) Store.fs.rmSync(dir, { recursive: true, force: true }); else Store.fs.rmdirSync(dir, { recursive: true }); } catch (e) { /* pas grave */ }
    }
    // Fichiers d'un dossier, triés (images numérotées).
    const listDir = (dir, re) => { try { return Store.fs.readdirSync(dir).filter(n => !re || re.test(n)).sort().map(n => Store.path.join(dir, n)); } catch (e) { return []; } };
    // Pour les outils sans avancement : le nombre de fichiers écrits dans out, sur total.
    function watchCount(dir, total, label) {
      const t = setInterval(() => { const n = listDir(dir).length; if (total) app.status.progress(Math.min(n, total), total, label); }, 700);
      return () => clearInterval(t);
    }

    // ---------------------------------------------------------------- téléchargements

    function getUrl(url, onRes, hops) {
      const lib = node(/^http:/i.test(url) ? 'http' : 'https');
      return lib.get(url, { headers: { 'User-Agent': 'RRFX' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 8) {
          res.resume();
          return getUrl(new URL(res.headers.location, url).toString(), onRes, (hops || 0) + 1);
        }
        onRes(res);
      });
    }
    // Fichier téléchargé au fil de l'eau (jusqu'à plusieurs Go), sans tout garder en mémoire.
    function download(url, file, label, mb) {
      return new Promise((resolve, reject) => {
        const part = file + '.part';
        const req = getUrl(url, res => {
          if (res.statusCode !== 200) { res.resume(); return reject(new Error(_T('Téléchargement refusé (') + res.statusCode + ') : ' + url)); }
          const total = Number(res.headers['content-length']) || (mb || 0) * 1e6, out = Store.fs.createWriteStream(part);
          let got = 0;
          app.S.onCancel = () => res.destroy(new Error(_T('Arrêté')));
          res.on('data', c => { got += c.length; if (total) app.status.progress(Math.min(got, total), total, label + ' · ' + Lb.size(got / 1e6)); });
          res.on('error', e => { out.destroy(); reject(e); });
          out.on('error', reject);
          out.on('finish', () => { app.S.onCancel = null; try { Store.fs.renameSync(part, file); resolve(file); } catch (e) { reject(e); } });
          res.pipe(out);
        });
        req.on('error', e => reject(new Error(_T('Pas de connexion à ') + new URL(url).host + ' (' + (e.code || e.message) + ')')));
      });
    }
    function getJSON(url) {
      return new Promise((resolve, reject) => {
        getUrl(url, res => {
          let t = '';
          res.setEncoding('utf8');
          res.on('data', d => { t += d; });
          res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { reject(new Error(_T('Réponse illisible de ') + url)); } });
        }).on('error', reject);
      });
    }
    // Décompression par tar (fourni avec Windows 10+ et macOS : .zip, .tar.gz, .tar.bz2, .whl).
    function extract(archive, dir) {
      const tar = win() ? Store.path.join((proc().env || {}).SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
      mkdir(dir);
      return run(tar, ['-xf', archive, '-C', dir], { label: _T('Décompression') });
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
      if (exists(x.exe)) return x.exe;
      if (found[id] && exists(found[id])) return found[id];
      if (t.script) {
        const py = Lb.venv(venvDir(t.venv), win()).python;
        return (found[id] = exists(py) && exists(marker(t)) ? py : '');
      }
      let exe = '';
      const d = toolDir(id);
      if (exists(d)) exe = Lb.findExe(Store.listFiles(d, /./, 5000, 6), t.exe, win());
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
        app.status.phase(_T('Installation de Python ') + Lb.PYTHON.version);
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
      app.status.phase(_T('Environnement Python de RR FX'));
      await run(py.cmd, py.args.concat(['-m', 'venv', dir]), { label: 'Python' });
      if (!exists(v.python)) throw new Error(_T('L\'environnement Python n\'a pas été créé (') + dir + ').');
      return v;
    }
    // pkg : un ou plusieurs paquets séparés par des espaces (« transformers>=4.56 torch »).
    async function pipInstall(pkg, name, min, venvName) {
      const v = await ensureVenv(min, venvName);
      app.status.phase(_T('Installation de ') + name + _T(' (Python, peut prendre plusieurs minutes)'));
      await run(v.python, Lb.pipArgs(String(pkg).split(/\s+/).filter(Boolean)), {
        label: name,
        onLine: l => { const s = Lb.pipStep(l); if (s) app.status.phase(name + ' · ' + (s.last ? _T('installation') : s.what + (s.size ? ' (' + s.size + ')' : ''))); }
      });
    }

    // ---------------------------------------------------------------- installer

    async function fetchModel(id, m) {
      const dir = mkdir(Store.path.join(toolDir(id), 'models')), target = Store.path.join(dir, m.file);
      if (exists(target)) return target;
      const name = m.url.replace(/^.*\//, '');
      if (m.extract) {
        const tmp = work('modele'), a = Store.path.join(tmp, name);
        await download(m.url, a, _T('Modèle'), m.mb);
        await extract(a, dir);
        clean(tmp);
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
        await download(how.url, a, t.name, t.mb);
        stopped();
        await extract(a, dir);
        clean(tmp);
        await unlock(dir, Store.listFiles(dir, /./, 5000, 6).filter(f => t.exe.indexOf(Store.path.basename(f)) >= 0));
      } else if (how.type === 'wheel') {
        app.status.phase(t.name + _T(' : recherche de la dernière version'));
        const meta = await getJSON('https://pypi.org/pypi/' + how.pkg + '/json'), w = Lb.pickWheel(meta.urls, P());
        if (!w) throw new Error(t.name + _T(' : aucun paquet pour ce système.'));
        const tmp = work(t.id), a = Store.path.join(tmp, w.filename);
        await download(w.url, a, t.name, (w.size || 0) / 1e6);
        const x = mkdir(Store.path.join(tmp, 'x'));
        await extract(a, x);
        const re = new RegExp(how.member), files = Store.listFiles(x, /./, 20000, 8);
        const member = files.find(f => re.test(Store.path.relative(x, f).split(Store.path.sep).join('/')));
        if (!member) throw new Error(t.name + _T(' : exécutable absent du paquet ') + w.filename);
        const f = Store.path.join(dir, how.rename ? Lb.exeName(how.rename, win()) : Store.path.basename(member));
        Store.fs.copyFileSync(member, f);
        clean(tmp);
        await unlock(dir, [f]);
      } else if (how.type === 'pip') {
        await pipInstall(how.pkg, t.name, t.minPy, t.venv);
        if (t.script) Store.fs.writeFileSync(marker(t), how.pkg + '\n' + new Date().toISOString() + '\n');
      } else if (how.type === 'brew') {
        const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(exists);
        if (!brew) {
          if (how.fallback) return installWith(t, how.fallback);
          throw new Error(_T('Homebrew est nécessaire (brew.sh), ou installe ') + t.name + _T(' toi-même.'));
        }
        app.status.phase(_T('Installation de ') + t.name + ' (Homebrew)');
        await run(brew, ['install', how.formula], { label: t.name, env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' } });
      }
      return null;
    }

    // Installe l'outil (dans une tâche déjà lancée). → chemin de l'exécutable.
    async function installCore(id) {
      if (!Store.fs) throw warn(_T('Disponible dans Premiere'), _T('Les outils s\'installent depuis Premiere.'));
      const t = Lb.byId(id), how = Lb.howFor(t, P());
      if (!how) throw new Error(t.name + _T(' ne s\'installe pas tout seul sur ce système : ') + t.site);
      app.status.phase(_T('Installation de ') + t.name);
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
    const install = id => app.runTask(_T('Installation de ') + Lb.byId(id).name, async () => {
      const exe = await installCore(id);
      return { kind: 'ok', title: Lb.byId(id).name + _T(' est prêt'), detail: exe };
    }, true).then(r => { refreshSection(); return r; });

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
        app.S.onCancel = () => req.destroy(new Error(_T('Arrêté')));
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
      app.status.phase(_T('Téléchargement du modèle ') + model);
      let failed = '';
      await ollamaCall('POST', '/api/pull', { model, stream: true }, m => {
        if (m.error) failed = m.error;
        else if (m.total) app.status.progress(m.completed || 0, m.total, model + ' · ' + Lb.size((m.completed || 0) / 1e6) + ' / ' + Lb.size(m.total / 1e6));
        else if (m.status) app.status.phase(model + ' · ' + m.status);
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
      const kids = [
        h('div', { class: 'tool-head' }, h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, t.icon), h('strong', null, t.name), pill),
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
          b.addEventListener('click', () => app.runTask(_T('Modèles Ollama'), async () => {
            for (const m of missing) { stopped(); await pull(m); }
            return { kind: 'ok', title: app.plural(missing.length, _T('modèle prêt'), _T('modèles prêts')), detail: missing.join(', ') };
          }, true).then(() => check('ollama')).then(refreshSection));
          box.appendChild(h('div', { class: 'row-buttons' }, b));
        }
      }
      return box;
    }

    function fill(box) {
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'note' }, _T('Des outils gratuits et open source qui tournent sur ton ordinateur : rien n\'est envoyé en ligne. Chacun est optionnel ; RR FX propose aussi de l\'installer au moment où une fonction en a besoin. Tout va dans Documents/RRFX/Outils.')));
      box.appendChild(h('div', { class: 'note' }, _T('Intégré, rien à installer : la détection de la voix (Silero) pour couper les silences, et la détection des visages (YuNet).')));
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

    app.tools = {
      find, need, install, installCore, run, runPy, work, clean, listDir, watchCount, download, models, fetchModel, audioOf, probe, toolDir,
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
