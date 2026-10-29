/* RR FX : transcription automatique avec Whisper (onglet Parole > Transcrire).
   Whisper est un outil gratuit qui tourne sur ton ordinateur (rien n'est envoyé en ligne) :
   whisper.cpp (whisper-cli, conseillé) avec un modèle que RR FX télécharge, ou openai-whisper.
   Les plans parlés sélectionnés → un mot horodaté par mot → le .srt de l'onglet Parole (une phrase
   par sous-titre), et les mots servent aussi aux « euh » et répétitions (au mot près), aux extraits
   et aux chapitres. Calculs : whisper.js. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const W = root.RRFXWhisper, L = root.RRFXLiens, Sons = root.RRFXSons, Tr = root.RRFXTraduction, Sp = root.RRFXSpeech;
    const { Store } = app;
    const { h, row, picker, checkbox } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.whisper || typeof s.whisper !== 'object') s.whisper = {};
      const d = { exe: '', size: 'base', lang: 'auto', keepFillers: true };
      Object.keys(d).forEach(k => { if (!(k in s.whisper)) s.whisper[k] = d[k]; });
      return s.whisper;
    };
    const dir = () => { const d = Store.path.join(Store.dir, 'Whisper'); Store.fs.mkdirSync(d, { recursive: true }); return d; };
    const proc = () => (root.process || {});
    const modelPath = size => Store.path.join(dir(), W.modelFile(size));
    // cutBase : les coupes déjà faites quand la transcription a été faite (les mots en tiennent compte).
    let words = [], found = null, cutBase = 0;

    // ---------------------------------------------------------------- outil et modèle

    async function findWhisper() {
      const x = st();
      if (x.exe && Store.fs.existsSync(x.exe)) return x.exe;
      // Installé par RR FX (Réglages › Outils gratuits) ou trouvé par le gestionnaire d'outils.
      const t = app.tools ? await app.tools.find('whisper') : '';
      if (t) return t;
      for (const tool of W.TOOLS) {
        const r = await Store.execFile(Store.isWin() ? 'where' : 'which', [tool]);
        const first = r.ok ? String(r.out).split(/\r?\n/).map(s => s.trim()).find(Boolean) : '';
        if (first && Store.fs.existsSync(first)) return first;
        const c = L.candidates(tool, proc().platform, proc().env).find(p => { try { return Store.fs.existsSync(p); } catch (e) { return false; } });
        if (c) return c;
      }
      return '';
    }
    async function status() {
      if (!Store.fs) return { demo: true };
      const exe = await findWhisper(), cpp = exe && W.isCpp(exe);
      found = { exe, cpp, model: cpp ? Store.fs.existsSync(modelPath(st().size)) : true };
      return found;
    }

    // Téléchargement du modèle, écrit au fil de l'eau (jusqu'à 1,5 Go), redirections comprises.
    function downloadModel(size) {
      return app.runTask(_T('Modèle Whisper'), async () => {
        if (!Store.fs) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('Le modèle se télécharge dans Documents/RRFX/Whisper.') };
        const https = Store.nodeRequire('https'), fs = Store.fs, out = modelPath(size), part = out + '.part', m = W.MODELS.find(q => q.id === size);
        await new Promise((resolve, reject) => {
          const get = (url, hops) => https.get(url, { headers: { 'User-Agent': 'RRFX' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) { res.resume(); return get(new URL(res.headers.location, url).toString(), hops + 1); }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(_T('Téléchargement refusé (') + res.statusCode + ').')); }
            const total = Number(res.headers['content-length']) || m.mb * 1e6, file = fs.createWriteStream(part);
            let got = 0;
            app.S.onCancel = () => { res.destroy(new Error(_T('Arrêté'))); };
            res.on('data', c => { got += c.length; app.status.progress(Math.round(got / total * 100), 100, _T('Modèle ') + size + ' · ' + Math.round(got / 1e6) + ' Mo'); });
            res.pipe(file);
            file.on('finish', () => { app.S.onCancel = null; resolve(); });
            res.on('error', e => { file.destroy(); reject(e); });
          }).on('error', reject);
          get(W.modelUrl(size), 0);
        });
        fs.renameSync(part, out);
        found = null;
        return { kind: 'ok', title: _T('Modèle « ') + size + _T(' » prêt'), detail: out };
      });
    }

    // ---------------------------------------------------------------- transcription

    function runTool(exe, args, dur) {
      return new Promise((resolve, reject) => {
        const cp = Store.nodeRequire('child_process').spawn(exe, args, { windowsHide: true });
        let err = '';
        const onData = d => {
          const t = String(d);
          if (err.length < 40000) err += t;
          t.split(/[\r\n]+/).forEach(l => { const p = W.progressOf(l, dur); if (p !== null) app.status.progress(Math.round(p * 100), 100, _T('Transcription')); });
        };
        cp.stdout.on('data', onData);
        cp.stderr.on('data', onData);
        app.S.onCancel = () => { try { cp.kill(); } catch (e) { /* déjà fini */ } };
        cp.on('error', reject);
        cp.on('close', code => {
          app.S.onCancel = null;
          if (code === 0) resolve();
          else reject(new Error(err.trim().split(/\r?\n/).filter(Boolean).pop() || _T('Whisper s\'est arrêté (code ') + code + ')'));
        });
      });
    }

    // Un plan : son en WAV 16 kHz → Whisper → mots, en secondes de séquence.
    async function transcribeClip(c, exe, i) {
      const x = st(), a = await app.speech.readClip(c);
      if (!a) return [];
      const base = Store.path.join(dir(), 'plan-' + i), wav = base + '.wav', pcm = W.to16k(a.samples, a.sr);
      Store.fs.writeFileSync(wav, Buffer.from(Sons.wav(pcm, 16000)));
      const lang = x.lang === 'auto' ? ((root.RRFXI18n && root.RRFXI18n.lang) === 'en' ? 'en' : 'fr') : x.lang;
      const prompt = x.keepFillers ? W.PROMPTS[lang] || '' : '';
      const cpus = (() => { try { return Store.nodeRequire('os').cpus().length; } catch (e) { return 4; } })();
      await runTool(exe, W.args(exe, { model: modelPath(x.size), wav, out: base, lang: x.lang, threads: Math.max(2, Math.min(8, cpus - 1)), prompt, dir: dir(), size: x.size }), pcm.length / 16000);
      const json = JSON.parse(Store.fs.readFileSync(W.isCpp(exe) ? base + '.json' : Store.path.join(dir(), Store.path.basename(wav).replace(/\.wav$/, '.json')), 'utf8'));
      try { Store.fs.unlinkSync(wav); } catch (e) { /* fichier temporaire */ }
      return W.parse(json).map(w => ({ text: w.text, start: a.toSeq(w.start), end: a.toSeq(w.end) })).filter(w => w.start < c.end + 0.05 && w.end > c.start - 0.05);
    }

    // Mode démo : la phrase de démonstration, posée sur la voix de démonstration.
    function demoWords(clips) {
      const text = 'Bonjour à tous, euh, aujourd\'hui je vous montre notre nouveau café. On a, on a tout refait de A à Z. Et le plus beau, hum, c\'est la terrasse ! Vous venez quand ?';
      const out = [], list = text.split(' ');
      clips.forEach(c => {
        const step = Math.min(0.42, (c.end - c.start) / list.length);
        list.forEach((t, k) => out.push({ text: t, start: c.start + 0.3 + k * step, end: c.start + 0.3 + k * step + step * 0.8 }));
      });
      return out;
    }

    function transcribe() {
      return app.runTask(_T('Transcription'), async () => {
        const clips = await app.speech.clips();
        let exe = '';
        if (!app.S.demo) {
          let s = await status();
          if (!s.exe && app.tools) {
            await app.tools.need('whisper', _T('Whisper écrit ce qui est dit dans les plans sélectionnés.'));
            found = null;
            s = await status();
          }
          if (!s.exe) return { kind: 'warn', title: _T('Whisper n\'est pas installé'), detail: _T('Installe whisper.cpp (Mac : brew install whisper-cpp ; Windows : le zip whisper-bin-x64 de GitHub dans Documents/RRFX/Outils), puis réessaie. Voir Parole > Transcrire.') };
          if (s.cpp && !s.model) return { kind: 'warn', title: _T('Modèle à télécharger'), detail: _T('Clique sur « Télécharger le modèle » (une seule fois).') };
          exe = s.exe;
        }
        let all = [];
        if (app.S.demo) all = demoWords(clips);
        else for (let i = 0; i < clips.length; i++) {
          if (app.S.cancel) break;
          app.status.phase(_T('Transcription de ') + clips[i].name + ' (' + (i + 1) + '/' + clips.length + ')');
          all = all.concat(await transcribeClip(clips[i], exe, i));
        }
        all.sort((p, q) => p.start - q.start);
        if (!all.length) return { kind: 'warn', title: _T('Aucun mot reconnu'), detail: _T('Vérifie que les plans sélectionnés ont du son où l\'on parle.') };
        words = all;
        cutBase = app.speech.lastCuts ? app.speech.lastCuts().length : 0;
        const cues = W.cues(words);
        const sp = app.speech.settings();
        if (sp.srt && sp.srt.trim() && !(await app.confirmDialog(_T('Remplacer les sous-titres ?'), _T('L\'onglet Parole a déjà un .srt : la transcription le remplace.'), _T('Remplacer')))) {
          return { kind: 'ok', title: app.plural(words.length, _T('mot reconnu'), _T('mots reconnus')), detail: _T('Sous-titres gardés. Les « euh » et répétitions utiliseront la transcription.') };
        }
        sp.srt = Tr.toSrt(cues);
        if (app.S.tab === 'speech') setTimeout(() => app.switchTab('speech'), 0);
        // Les temps sont ceux de la séquence : les sous-titres partent de son début.
        sp.capFrom = 'start';
        app.persist();
        if (Store.fs) try { Store.fs.writeFileSync(Store.path.join(dir(), _T('derniere-transcription') + '.srt'), sp.srt, 'utf8'); } catch (e) { /* copie facultative */ }
        const f = W.fillers(words).length, r = W.repeats(words).length;
        return { kind: 'ok', title: app.plural(cues.length, _T('sous-titre'), _T('sous-titres')) + ' · ' + app.plural(words.length, _T('mot'), _T('mots')), saved: cues.length,
          detail: (f || r ? app.plural(f, _T('« euh »'), _T('« euh »')) + _T(' et ') + app.plural(r, _T('répétition')) + _T(' repérés au mot près. ') : '') + _T('Le .srt est dans Sous-titres : vérifie-le avec le Correcteur, puis pose les sous-titres, coupe les « euh », crée les chapitres ou les extraits.') };
      }, true);
    }

    // Les mots de la transcription, recalés sur les coupes faites depuis (silences, euh).
    app.transcript = {
      words: () => {
        const cuts = app.speech.lastCuts ? app.speech.lastCuts().slice(cutBase) : [];
        return cuts.reduce((acc, c) => Sp.remap(acc, c.ranges), words);
      },
      fillers: () => W.fillers(app.transcript.words()),
      repeats: () => W.repeats(app.transcript.words()),
      has: () => words.length > 0
    };

    // ---------------------------------------------------------------- section

    app.extras.speech.unshift({
      id: 'transcrire', title: _T('Transcription automatique (Whisper)'), nav: _T('Transcrire'), tool: [_T('Transcrire les plans'), () => transcribe()],
      render: () => {
        const x = st(), box = h('div'), state = h('div', { class: 'note' }, Store.fs ? _T('Recherche de Whisper…') : _T('Disponible dans Premiere (mode démo ici : une transcription d\'exemple).'));
        const go = h('button', { class: 'action go' }, _T('Transcrire les plans sélectionnés'));
        go.addEventListener('click', transcribe);
        const dl = h('button', { class: 'action hidden' });
        dl.addEventListener('click', () => downloadModel(x.size).then(refresh));
        const inst = h('button', { class: 'action hidden' }, _T('Installer Whisper'));
        inst.addEventListener('click', () => app.tools.install('whisper').then(() => { found = null; refresh(); }));
        const pick = h('button', { class: 'action quiet', disabled: !Store.fs }, _T('Choisir l\'outil…'));
        pick.addEventListener('click', () => { const f = Store.pickFiles(_T('Whisper (whisper-cli ou whisper)'), []); if (f && f[0]) { x.exe = f[0]; app.persist(); found = null; refresh(); } });
        function refresh() {
          if (!Store.fs) return;
          status().then(s => {
            const m = W.MODELS.find(q => q.id === x.size);
            state.textContent = !s.exe ? _T('Whisper n\'est pas installé : « Installer Whisper » le fait pour toi (gratuit, sur ton ordinateur).')
              : (s.cpp ? 'whisper.cpp · ' : 'openai-whisper · ') + s.exe + (s.cpp ? (s.model ? _T(' · modèle prêt') : _T(' · modèle à télécharger')) : '');
            dl.textContent = _T('Télécharger le modèle (') + (m.mb >= 1000 ? (m.mb / 1000).toFixed(1).replace('.', ',') + ' Go' : m.mb + ' Mo') + ')';
            dl.classList.toggle('hidden', !(s.exe && s.cpp && !s.model));
            inst.classList.toggle('hidden', !!s.exe || !app.tools);
          }).catch(e => { state.textContent = app.errorMessage(e); });
        }
        box.append(
          h('div', { class: 'note' }, _T('Whisper écrit tout ce qui est dit, mot par mot, sur ton ordinateur (rien n\'est envoyé en ligne) : le .srt se fait tout seul, et les « euh », répétitions, extraits et chapitres deviennent bien plus justes.')),
          state,
          row(_T('Modèle'), picker(W.MODELS.map(m => ({ v: m.id, label: _T(m.label) })), x.size, v => { x.size = v; app.persist(); found = null; refresh(); })),
          row(_T('Langue'), picker([{ v: 'auto', label: _T('Détectée') }, { v: 'fr', label: 'Français' }, { v: 'en', label: 'English' }, { v: 'es', label: 'Español' }, { v: 'de', label: 'Deutsch' }, { v: 'it', label: 'Italiano' }, { v: 'pt', label: 'Português' }], x.lang, v => { x.lang = v; app.persist(); })),
          checkbox(_T('Garder les « euh » dans la transcription (pour les couper ensuite)'), x.keepFillers, v => { x.keepFillers = v; app.persist(); }),
          h('div', { class: 'row-buttons wrap' }, go, inst, dl, pick));
        if (words.length) box.appendChild(h('div', { class: 'note' }, app.plural(words.length, _T('mot'), _T('mots')) + _T(' en mémoire : « euh » et répétitions au mot près.')));
        refresh();
        return [box];
      }
    });

    app.actions.transcribe = () => transcribe();
  });
})(typeof self !== 'undefined' ? self : this);
