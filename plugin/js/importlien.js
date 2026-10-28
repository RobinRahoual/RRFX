/* RR FX : importer une vidéo (MP4) ou un son (MP3) depuis un lien, posé dans la timeline à la
   tête de lecture. Lien direct vers un fichier (.mp4, .mp3, .wav…, Dropbox, Google Drive) :
   téléchargé par le panneau. Lien de plateforme (YouTube, Vimeo, SoundCloud…) : par yt-dlp, outil
   gratuit installé par l'utilisateur (RR FX le trouve tout seul, ou on lui indique où il est).
   Les fichiers vont dans Documents/RRFX/Téléchargements. À réserver aux contenus dont on a les
   droits : le panneau le rappelle. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const L = root.RRFXLiens, I = root.RRFXInstaller, { Store, Host } = app;
    const { h, actionGroup, row, section } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.linkImport || typeof s.linkImport !== 'object') s.linkImport = {};
      const d = { url: '', mode: 'video', ytdlp: '', ffmpeg: '' };
      Object.keys(d).forEach(k => { if (!(k in s.linkImport)) s.linkImport[k] = d[k]; });
      return s.linkImport;
    };
    const outDir = () => { const d = Store.path.join(Store.dir, 'Téléchargements'); Store.fs.mkdirSync(d, { recursive: true }); return d; };
    const proc = () => (root.process || {});

    // Un outil (yt-dlp, ffmpeg) : réglage, puis PATH, puis emplacements habituels. → chemin ou ''.
    async function findTool(tool, saved) {
      if (saved && Store.fs.existsSync(saved)) return saved;
      const r = await Store.execFile(Store.isWin() ? 'where' : 'which', [tool]);
      const first = r.ok ? String(r.out).split(/\r?\n/).map(x => x.trim()).find(Boolean) : '';
      if (first && Store.fs.existsSync(first)) return first;
      return L.candidates(tool, proc().platform, proc().env).find(p => { try { return Store.fs.existsSync(p); } catch (e) { return false; } }) || '';
    }

    // Lancement de yt-dlp, progression suivie ligne par ligne. → chemin du fichier téléchargé.
    function runYtdlp(exe, args, dir) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now() - 2000, cp = Store.nodeRequire('child_process').spawn(exe, args, { windowsHide: true });
        cp.stdout.setEncoding('utf8');
        cp.stderr.setEncoding('utf8');
        // Chemin affiché mal encodé (console Windows) : le fichier le plus récent du dossier.
        const newest = () => Store.fs.readdirSync(dir).map(n => Store.path.join(dir, n)).filter(f => !/\.(part|ytdl|tmp)$/i.test(f))
          .map(f => ({ f, t: Store.fs.statSync(f).mtimeMs })).filter(x => x.t >= t0).sort((a, b) => b.t - a.t).map(x => x.f)[0] || '';
        // --print rend yt-dlp silencieux : le chemin final sort sur stdout, la progression sur stderr.
        let last = '', errOut = '', buf = '', ebuf = '';
        const onProgress = line => { const p = L.progressOf(line); if (p !== null) app.status.progress(Math.round(p * 100), 100, 'Téléchargement'); return p !== null; };
        const onLine = line => { if (!onProgress(line) && line.trim() && !/^\[/.test(line)) last = line.trim(); };
        cp.stdout.on('data', d => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); });
        cp.stderr.on('data', d => { errOut += d; ebuf += d; const lines = ebuf.split(/[\r\n]+/); ebuf = lines.pop(); lines.forEach(onProgress); if (errOut.length > 20000) errOut = errOut.slice(-10000); });
        app.S.onCancel = () => { try { cp.kill(); } catch (e) { /* déjà fini */ } };
        cp.on('error', reject);
        cp.on('close', code => {
          if (buf) onLine(buf);
          app.S.onCancel = null;
          const got = code === 0 ? (last && Store.fs.existsSync(last) ? last : newest()) : '';
          if (got) resolve(got);
          else reject(new Error((errOut.split(/\r?\n/).filter(l => /ERROR/.test(l)).pop() || errOut.trim().split(/\r?\n/).pop() || 'yt-dlp s\'est arrêté (code ' + code + ')').replace(/^ERROR:\s*/, '')));
        });
      });
    }

    async function needYtdlp() {
      const x = st();
      const win = Store.isWin();
      const how = h('div', null,
        h('p', null, 'Pour YouTube, Vimeo, SoundCloud… RR FX utilise yt-dlp, un outil gratuit et open source, à installer une fois :'),
        h('div', { class: 'code' }, win ? 'winget install yt-dlp' : 'brew install yt-dlp'),
        h('p', { class: 'note' }, (win ? 'Dans le Terminal Windows (ou télécharge yt-dlp.exe sur github.com/yt-dlp/yt-dlp).' : 'Dans le Terminal (Homebrew), ou télécharge yt-dlp sur github.com/yt-dlp/yt-dlp.') + ' Avec ffmpeg installé aussi, les sons sortent en MP3 et les vidéos en meilleure qualité. Puis redémarre Premiere, ou indique où se trouve yt-dlp.'));
      const v = await app.modal('yt-dlp introuvable', how, [{ label: 'Fermer', value: null }, { label: 'Indiquer yt-dlp…', primary: true, value: 'pick' }]);
      if (v !== 'pick') return '';
      const files = Store.pickFiles('Où est yt-dlp ?', []);
      if (files && files.length) { x.ytdlp = files[0]; app.persist(); return files[0]; }
      return '';
    }

    function importLink() {
      const x = st();
      return app.runTask('Import depuis un lien', async () => {
        if (!Store.fs) return { kind: 'warn', title: 'Disponible dans Premiere', detail: 'Le téléchargement passe par Premiere (mode démo ici).' };
        const c = L.classify(x.url);
        if (!c.ok) return { kind: 'error', title: 'Lien non reconnu', detail: c.why };
        let file;
        if (c.kind === 'direct') {
          app.status.phase('Téléchargement');
          // http ou https selon le lien (et selon chaque redirection).
          const net = { get: (u, o, cb) => Store.nodeRequire(/^http:/i.test(u) ? 'http' : 'https').get(u, o, cb) };
          const bytes = await I.download(net, c.url, p => app.status.progress(Math.round(p * 100), 100, 'Téléchargement'));
          // Pas d'extension dans le lien (Google Drive) : devinée d'après le début du fichier.
          const sig = String.fromCharCode.apply(null, bytes.slice(0, 12));
          const ext = c.ext || (/ftyp/.test(sig) ? 'mp4' : /^ID3|^\xff\xfb/.test(sig) ? 'mp3' : /^RIFF/.test(sig) ? 'wav' : x.mode === 'audio' ? 'mp3' : 'mp4');
          if (bytes.length < 1024 || /^<!doctype|^<html/i.test(sig.trim())) throw new Error('Le lien renvoie une page web, pas un fichier (lien de partage privé ?).');
          file = Store.path.join(outDir(), L.nameFromUrl(c.url, ext));
          Store.fs.writeFileSync(file, Buffer.from(bytes));
        } else {
          let exe = await findTool('yt-dlp', x.ytdlp);
          if (!exe) exe = await needYtdlp();
          if (!exe) return { kind: 'warn', title: 'yt-dlp nécessaire', detail: 'Installe yt-dlp (voir la fenêtre) puis relance l\'import.' };
          const ffmpeg = await findTool('ffmpeg', x.ffmpeg);
          app.status.phase('Téléchargement (yt-dlp)');
          file = await runYtdlp(exe, L.ytdlpArgs({ url: c.url, mode: x.mode, out: outDir(), ffmpeg }), outDir());
        }
        app.status.phase('Pose dans la timeline');
        const ext = L.extOf(file), audioOnly = x.mode === 'audio' || L.isAudio(ext);
        const m = await Host.call('markerList', {});
        const t = m.ok ? m.playhead : 0, created = [], warnings = [];
        for (const kind of audioOnly ? ['audio'] : ['video', 'audio']) {
          const r = await Host.call('placeAsset', { kind, path: file, name: Store.path.basename(file), times: [t] });
          if (r.ok) { created.push(...r.created); warnings.push(...(r.warnings || [])); } else if (kind === 'video' || audioOnly) return { kind: 'error', title: 'Fichier téléchargé mais non posé', detail: r.error + ' · ' + file };
          else warnings.push('Son de la vidéo non posé : ' + r.error);
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: 'Import · ' + Store.path.basename(file), entries: created });
        warnings.forEach(w => app.log(w, 'warn'));
        return { kind: warnings.length ? 'warn' : 'ok', title: (audioOnly ? 'Son' : 'Vidéo') + ' importé' + (audioOnly ? '' : 'e') + ' à la tête de lecture', detail: Store.path.basename(file) + ' · rangé dans Documents/RRFX/Téléchargements et dans le chutier « RR FX Ressources ».' };
      }, true);
    }

    function linkSection() {
      const x = st();
      const input = h('input', { class: 'textfield', value: x.url, placeholder: 'https://… (YouTube, Vimeo, SoundCloud, lien .mp4 / .mp3, Dropbox…)', 'aria-label': 'Lien à importer' });
      const hint = h('div', { class: 'note' });
      const check = () => {
        const c = L.classify(x.url);
        hint.textContent = !x.url ? '' : !c.ok ? c.why : c.kind === 'direct' ? 'Lien direct : téléchargé par RR FX.' : c.host + ' : téléchargé avec yt-dlp (installé une fois, gratuit).';
      };
      input.addEventListener('input', () => { x.url = input.value.trim(); app.persist(); check(); });
      check();
      const go = h('button', { class: 'action go' }, 'Importer dans la timeline');
      go.addEventListener('click', importLink);
      return section('Importer depuis un lien', [
        input, hint,
        row('Garder', actionGroup([{ v: 'video', label: '🎬 Vidéo (MP4)' }, { v: 'audio', label: '🎵 Son (MP3)' }], x.mode, v => { x.mode = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, go),
        h('div', { class: 'note' }, 'Posé à la tête de lecture, sur une piste libre. Uniquement des contenus dont tu as les droits : tes vidéos, musiques libres de droits ou Creative Commons, contenus fournis par ton client. Télécharger depuis YouTube sans autorisation est contraire à ses conditions d\'utilisation.')
      ]);
    }

    app.linkImport = { section: linkSection, run: importLink };
    app.actions.importLink = importLink;
  });
})(typeof self !== 'undefined' ? self : this);
