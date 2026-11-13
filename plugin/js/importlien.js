/* RR FX : importer une vidéo (MP4) ou un son (MP3) depuis un lien, posé dans la timeline à la
   tête de lecture. Lien direct vers un fichier (.mp4, .mp3, .wav…, Dropbox, Google Drive) :
   téléchargé par le panneau. Lien de plateforme (YouTube, Vimeo, SoundCloud…) : par yt-dlp, outil
   gratuit installé par l'utilisateur (RR FX le trouve tout seul, ou on lui indique où il est).
   Les fichiers vont dans Documents/RRFX/Téléchargements. À réserver aux contenus dont on a les
   droits : le panneau le rappelle. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

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
    // Rangement : dossier assets du projet (dossiers.js), sinon Documents/RRFX/Téléchargements.
    const Dos = root.RRFXDossiers;
    const destination = cat => app.assetsFolder.dirForNow(cat, { fallback: 'Téléchargements' });

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
    let lastDuration = null;
    function runYtdlp(exe, args, dir) {
      lastDuration = null;
      return new Promise((resolve, reject) => {
        const t0 = Date.now() - 2000, cp = Store.nodeRequire('child_process').spawn(exe, args, { windowsHide: true });
        cp.stdout.setEncoding('utf8');
        cp.stderr.setEncoding('utf8');
        // Chemin affiché mal encodé (console Windows) : le fichier le plus récent du dossier.
        const newest = () => Store.fs.readdirSync(dir).map(n => Store.path.join(dir, n)).filter(f => !/\.(part|ytdl|tmp)$/i.test(f))
          .map(f => ({ f, t: Store.fs.statSync(f).mtimeMs })).filter(x => x.t >= t0).sort((a, b) => b.t - a.t).map(x => x.f)[0] || '';
        // --print rend yt-dlp silencieux : le chemin final sort sur stdout, la progression sur stderr.
        let last = '', errOut = '', buf = '', ebuf = '';
        const onProgress = line => { const p = L.progressOf(line); if (p !== null) app.status.progress(Math.round(p * 100), 100, _T('Téléchargement')); return p !== null; };
        // RRFXDUR=… : durée annoncée avant le téléchargement (rangement MUSIQUE / SFX).
        const onLine = line => { const d = Dos ? Dos.durationOf(line) : null; if (d !== null) { lastDuration = d; return; } if (!onProgress(line) && line.trim() && !/^\[/.test(line)) last = line.trim(); };
        cp.stdout.on('data', d => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); });
        cp.stderr.on('data', d => { errOut += d; ebuf += d; const lines = ebuf.split(/[\r\n]+/); ebuf = lines.pop(); lines.forEach(onProgress); if (errOut.length > 20000) errOut = errOut.slice(-10000); });
        app.S.onCancel = () => { try { cp.kill(); } catch (e) { /* déjà fini */ } };
        cp.on('error', reject);
        cp.on('close', code => {
          if (buf) onLine(buf);
          app.S.onCancel = null;
          const got = code === 0 ? (last && Store.fs.existsSync(last) ? last : newest()) : '';
          if (got) resolve(got);
          else reject(new Error((errOut.split(/\r?\n/).filter(l => /ERROR/.test(l)).pop() || errOut.trim().split(/\r?\n/).pop() || _T('yt-dlp s\'est arrêté (code ') + code + ')').replace(/^ERROR:\s*/, '')));
        });
      });
    }

    async function needYtdlp() {
      const x = st();
      const win = Store.isWin();
      const how = h('div', null,
        h('p', null, _T('Pour YouTube, Vimeo, SoundCloud… RR FX utilise yt-dlp, un outil gratuit et open source, à installer une fois :')),
        h('div', { class: 'code' }, win ? 'winget install yt-dlp' : 'brew install yt-dlp'),
        h('p', { class: 'note' }, (win ? _T('Dans le Terminal Windows (ou télécharge yt-dlp.exe sur github.com/yt-dlp/yt-dlp).') : _T('Dans le Terminal (Homebrew), ou télécharge yt-dlp sur github.com/yt-dlp/yt-dlp.')) + _T(' Avec ffmpeg installé aussi, les sons sortent en MP3 et les vidéos en meilleure qualité. Puis redémarre Premiere, ou indique où se trouve yt-dlp.')));
      const v = await app.modal(_T('yt-dlp introuvable'), how, [{ label: _T('Fermer'), value: null }, { label: _T('Indiquer yt-dlp…'), primary: true, value: 'pick' }]);
      if (v !== 'pick') return '';
      const files = Store.pickFiles(_T('Où est yt-dlp ?'), []);
      if (files && files.length) { x.ytdlp = files[0]; app.persist(); return files[0]; }
      return '';
    }

    function importLink() {
      const x = st();
      return app.runTask(_T('Import depuis un lien'), async () => {
        if (!Store.fs) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('Le téléchargement passe par Premiere (mode démo ici).') };
        const c = L.classify(x.url);
        if (!c.ok) return { kind: 'error', title: _T('Lien non reconnu'), detail: c.why };
        let file, dest;
        if (c.kind === 'direct') {
          app.status.phase(_T('Téléchargement'));
          // http ou https selon le lien (et selon chaque redirection). Le nom donné par le serveur
          // (Content-Disposition, Google Drive) est gardé.
          let disposition = '';
          const net = { get: (u, o, cb) => Store.nodeRequire(/^http:/i.test(u) ? 'http' : 'https').get(u, o, res => { if (res.statusCode === 200) disposition = res.headers['content-disposition'] || ''; cb(res); }) };
          const bytes = await I.download(net, c.url, p => app.status.progress(Math.round(p * 100), 100, _T('Téléchargement')));
          // Pas d'extension dans le lien (Google Drive) : devinée d'après le début du fichier.
          const sig = String.fromCharCode.apply(null, bytes.slice(0, 12));
          const ext = c.ext || (/ftyp/.test(sig) ? 'mp4' : /^ID3|^\xff\xfb/.test(sig) ? 'mp3' : /^RIFF/.test(sig) ? 'wav' : x.mode === 'audio' ? 'mp3' : 'mp4');
          if (bytes.length < 1024 || /^<!doctype|^<html/i.test(sig.trim())) throw new Error(_T('Le lien renvoie une page web, pas un fichier (lien de partage privé ?).'));
          const served = L.nameFromDisposition(disposition), servedExt = L.extOf(served);
          const name = served && (L.isAudio(servedExt) || L.isVideo(servedExt)) ? L.safeName(served.slice(0, -servedExt.length - 1), 'import') + '.' + servedExt : L.nameFromUrl(c.url, ext);
          dest = await destination(x.mode === 'audio' && !Dos.isAudio(name) ? 'SFX' : Dos.categoryOf(name, { bytes: bytes.length }));
          // Nom déjà pris (même lien importé deux fois) : « (2) », jamais un média de la timeline écrasé.
          file = Store.path.join(dest.dir, L.freeName(dest.dir, name, p => Store.fs.existsSync(p), Store.path));
          Store.fs.writeFileSync(file, Buffer.from(bytes), { flag: 'wx' });
        } else {
          // yt-dlp : un outil gratuit de RR FX, proposé à l'installation en un clic s'il manque.
          // Celui que RR FX a installé (Outils gratuits) d'abord, sinon le PATH et les emplacements habituels.
          let exe = x.ytdlp && Store.fs.existsSync(x.ytdlp) ? x.ytdlp : (app.tools && await app.tools.find('ytdlp')) || await findTool('yt-dlp', '');
          if (!exe && app.tools) exe = await app.tools.need('ytdlp', _T('Pour YouTube, Vimeo, SoundCloud, Instagram… RR FX télécharge avec yt-dlp, un outil gratuit installé une fois.'));
          if (!exe) exe = await needYtdlp();
          if (!exe) return { kind: 'warn', title: _T('yt-dlp nécessaire'), detail: _T('Installe yt-dlp (Réglages › Outils gratuits) puis relance l\'import.') };
          const ffmpeg = (app.tools && await app.tools.find('ffmpeg')) || await findTool('ffmpeg', x.ffmpeg);
          app.status.phase(_T('Téléchargement (yt-dlp)'));
          // Un son va d'abord dans SFX, puis en MUSIQUE s'il dure plus de 45 s (durée donnée par yt-dlp).
          dest = await destination(x.mode === 'audio' ? 'SFX' : 'VIDEOS');
          const args = L.ytdlpArgs({ url: c.url, mode: x.mode, out: dest.dir, ffmpeg });
          args.splice(args.indexOf('--'), 0, ...Dos.DURATION_ARGS);
          file = await runYtdlp(exe, args, dest.dir);
          if (dest.inProject && Dos.isAudio(file)) {
            let bytes = 0;
            try { bytes = Store.fs.statSync(file).size; } catch (e) { /* taille inconnue */ }
            const cat = Dos.categoryOf(file, { duration: lastDuration, bytes });
            if (cat !== dest.sub) { file = app.assetsFolder.moveTo(file, cat); dest = Object.assign({}, dest, { sub: cat, bin: 'assets/' + cat }); }
          }
        }
        app.status.phase(_T('Pose dans la timeline'));
        const ext = L.extOf(file), audioOnly = x.mode === 'audio' || L.isAudio(ext);
        const m = await Host.call('markerList', {});
        const t = m.ok ? m.playhead : 0, created = [], warnings = [];
        for (const kind of audioOnly ? ['audio'] : ['video', 'audio']) {
          const r = await Host.call('placeAsset', { kind, path: file, name: Store.path.basename(file), times: [t], bin: dest.bin || undefined });
          if (r.ok) { created.push(...r.created); warnings.push(...(r.warnings || [])); } else if (kind === 'video' || audioOnly) return { kind: 'error', title: _T('Fichier téléchargé mais non posé'), detail: r.error + ' · ' + file };
          else warnings.push(_T('Son de la vidéo non posé : ') + r.error);
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: 'Import · ' + Store.path.basename(file), entries: created });
        warnings.forEach(w => app.log(w, 'warn'));
        return { kind: warnings.length ? 'warn' : 'ok', title: (audioOnly ? _T('Son') : _T('Vidéo')) + _T(' importé') + (audioOnly ? '' : 'e') + _T(' à la tête de lecture'), detail: Store.path.basename(file) + (dest.bin
          ? _T(' · rangé dans le dossier du projet : assets/') + dest.sub + _T(' (et le chutier assets › ') + dest.sub + ').'
          : _T(' · projet pas encore enregistré : rangé dans Documents/RRFX/Téléchargements (chutier « RR FX Ressources »). Enregistre ton projet pour que les prochains aillent dans son dossier assets.')) };
      }, true);
    }

    function linkSection() {
      const x = st();
      const input = h('input', { class: 'textfield link-input', value: x.url, placeholder: 'https://… (YouTube, Vimeo, SoundCloud, lien .mp4 / .mp3, Dropbox…)', 'aria-label': _T('Lien à importer') });
      const hint = h('div', { class: 'note' });
      const check = () => {
        const c = L.classify(x.url);
        hint.textContent = !x.url ? '' : !c.ok ? c.why : c.kind === 'direct' ? _T('Lien direct : téléchargé par RR FX.') : c.host + _T(' : téléchargé avec yt-dlp (installé une fois, gratuit).');
      };
      input.addEventListener('input', () => { x.url = input.value.trim(); app.persist(); check(); });
      check();
      const go = h('button', { class: 'action go' }, _T('Importer dans la timeline'));
      go.addEventListener('click', importLink);
      return section(_T('Importer depuis un lien'), [
        input, hint,
        row(_T('Garder'), actionGroup([{ v: 'video', label: _T('🎬 Vidéo (MP4)') }, { v: 'audio', label: _T('🎵 Son (MP3)') }], x.mode, v => { x.mode = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, go),
        h('div', { class: 'note' }, _T('Rangé à côté de ton projet Premiere, dans assets : VIDEOS, MUSIQUE (sons de plus de 45 s), SFX, VOIX, IMAGES… (mêmes chutiers dans le panneau Projet).')),
        h('div', { class: 'note' }, _T('Posé à la tête de lecture, sur une piste libre. Uniquement des contenus dont tu as les droits : tes vidéos, musiques libres de droits ou Creative Commons, contenus fournis par ton client. Télécharger depuis YouTube sans autorisation est contraire à ses conditions d\'utilisation.'))
      ]);
    }

    app.linkImport = { section: linkSection, run: importLink };
    app.actions.importLink = importLink;
  });
})(typeof self !== 'undefined' ? self : this);
