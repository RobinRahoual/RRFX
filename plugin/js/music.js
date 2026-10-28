/* CutFX — onglet Musique : temps forts, montage auto sur le rythme, synchronisation
   son / image, et volume de la musique pour l'intensité des effets. */
(function (root) {
  'use strict';

  (root.CutFXFeatures = root.CutFXFeatures || []).push(function (app) {
    const { Core, Audio, Media, Store, Host } = app;
    const { h, hotText, actionGroup, picker, checkbox, row, section, fitCanvas, css } = app.UI;
    const M = { info: null, manual: null, key: '', samples: null, sr: 0, duration: 0, an: null, loud: null, sync: null, beats: null, zone: null };
    app.S.music = M;

    const DEFAULTS = {
      beats: { mode: 'kicks', sensitivity: 50, minGap: 120, every: 1, zone: 'music', replace: true },
      autoEdit: { source: 'markers', every: 2, order: 'sequence', pick: 'random' }
    };
    // Complète les réglages sans remplacer les objets (l'interface garde des références dessus).
    const st = () => {
      const s = app.settings();
      ['beats', 'autoEdit'].forEach(k => {
        if (!s[k] || typeof s[k] !== 'object') s[k] = {};
        Object.keys(DEFAULTS[k]).forEach(n => { if (!(n in s[k])) s[k][n] = DEFAULTS[k][n]; });
      });
      return s;
    };

    // ---------------------------------------------------------------- lecture du son

    async function decodeBytes(bytes) {
      const Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
      if (!Ctx) throw new Error('Décodage audio indisponible');
      const buf = await new Ctx(1, 1, 44100).decodeAudioData(bytes.slice().buffer);
      const n = buf.length, out = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels;
      }
      return { samples: out, sampleRate: buf.sampleRate };
    }

    function ioFor(src) {
      if (typeof src !== 'string') return Media.blobIO(src);
      if (!Store.fs) throw new Error('Lecture des fichiers disponible dans Premiere (ou choisis le fichier à la main).');
      return Media.nodeIO(Store.fs, src);
    }

    // Le son mono de [t0, t1] (secondes du fichier ; t1 = null : jusqu'à la fin).
    async function readAudio(src, t0, t1) {
      const io = ioFor(src);
      t0 = Math.max(0, t0 || 0);
      try {
        const info = await Media.probe(io);
        if (info.kind === 'wav' || info.kind === 'mp4') {
          const end = t1 == null ? info.duration : Math.min(t1, info.duration);
          const w = await Media.readWindow(io, info, t0, end);
          if (!w.adts) return { samples: w.samples, sampleRate: w.sampleRate, start: w.start, duration: info.duration };
          let d;
          try { d = await decodeBytes(w.adts); } catch (e) {
            throw new Error('Le son AAC de ce fichier ne peut pas être décodé ici : exporte-le en WAV, ou utilise Clip > Synchroniser de Premiere.');
          }
          const off = Math.max(0, Math.round((t0 - w.start) * d.sampleRate)), len = Math.round((end - t0) * d.sampleRate);
          return { samples: d.samples.subarray(off, off + len), sampleRate: d.sampleRate, start: t0, duration: info.duration };
        }
        // MP3, AIFF, FLAC… : le navigateur décode le fichier entier.
        const size = await io.size();
        if (size > 400 * 1024 * 1024) throw new Error('Fichier trop gros pour être décodé en entier : exporte le son en WAV.');
        const d = await decodeBytes(await io.read(0, size));
        const a = Math.round(t0 * d.sampleRate), b = t1 == null ? d.samples.length : Math.round(t1 * d.sampleRate);
        return { samples: d.samples.subarray(a, b), sampleRate: d.sampleRate, start: t0, duration: d.samples.length / d.sampleRate };
      } finally {
        if (io.close) io.close();
      }
    }

    // Au-dessus de 32 kHz, on divise la fréquence par deux pour aller plus vite.
    function decimate(x, sr) {
      if (sr <= 32000) return { x, sr };
      const n = x.length >> 1, y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = (x[2 * i] + x[2 * i + 1]) / 2;
      return { x: y, sr: sr / 2 };
    }

    const seqToFile = (info, t) => info.inPoint + (t - info.start) * (info.speed || 1);
    const fileToSeq = (info, t) => info.start + (t - info.inPoint) / (info.speed || 1);

    // La musique de la séquence, lue et analysée une fois (puis gardée en mémoire).
    async function ensureMusic(force) {
      let info;
      if (M.manual) info = M.info;
      else {
        const r = await Host.call('musicInfo', {});
        if (!r.ok) throw new Error(r.error);
        info = r;
        if (!info.path) throw new Error('Fichier de « ' + info.name + ' » introuvable : choisis-le à la main (Musique > Choisir un fichier).');
      }
      const key = M.manual ? 'file:' + M.manual.name + ':' + M.manual.size : info.path;
      if (!force && M.an && M.key === key) { M.info = info; return M; }
      const d = await readAudio(M.manual || info.path, 0, null);
      const dec = decimate(d.samples, d.sampleRate);
      Object.assign(M, { info, key, samples: dec.x, sr: dec.sr, duration: d.duration, sync: null, beats: null });
      M.an = Audio.analyze(dec.x, dec.sr, 100);
      M.loud = Audio.loudnessCurve(M.an);
      app.log('Musique analysée : ' + info.name + ' (' + Math.round(d.duration) + ' s)', 'ok');
      return M;
    }

    // Fichier choisi à la main : s'il y a une musique dans la séquence, on le cale sur elle
    // (cas courant : son introuvable ou illisible), sinon sa place est inconnue.
    async function useFile(file) {
      let seq = null;
      try { seq = await Host.call('musicInfo', {}); } catch (e) { seq = null; }
      M.manual = file;
      M.info = seq && seq.ok
        ? Object.assign({}, seq, { name: file.name, path: '', seqName: seq.name })
        : { name: file.name, path: '', start: 0, end: 0, inPoint: 0, speed: 1, manual: true };
      M.key = '';
      await ensureMusic(true);
      if (M.info.manual) M.info.end = M.duration;
      else app.log('« ' + file.name + ' » calé sur « ' + M.info.seqName + ' » de la séquence (début à ' + M.info.start.toFixed(2) + ' s).', 'info');
    }

    // Zone de détection (secondes de la séquence).
    async function zone() {
      const info = M.info, b = st().beats;
      let from = info.start, to = info.manual ? M.duration : info.end;
      if (b.zone !== 'music' && !info.manual) {
        const r = await Host.call('markerList', {});
        if (r.ok && b.zone === 'playhead') from = Math.max(from, r.playhead);
        if (r.ok && b.zone === 'selection') {
          if (!r.range) throw new Error('Sélectionne les clips de la zone (ou choisis « Toute la musique »).');
          from = Math.max(from, r.range.a);
          to = Math.min(to, r.range.b);
        }
      }
      return { from, to };
    }

    function detect(z) {
      const b = st().beats, info = M.info;
      M.zone = z;
      M.beats = Audio.detectBeats(M.an, {
        mode: b.mode, sensitivity: b.sensitivity, minGap: b.minGap / 1000, every: b.every,
        from: seqToFile(info, z.from), to: seqToFile(info, z.to)
      });
      return M.beats;
    }

    // Temps forts en secondes de séquence (pour les marqueurs, les textes, le montage).
    async function beatTimes() {
      await ensureMusic(false);
      const z = await zone();
      detect(z);
      return M.beats.times.map(t => fileToSeq(M.info, t)).filter(t => t >= z.from - 1e-6 && t <= z.to + 1e-6);
    }

    // ---------------------------------------------------------------- services pour les autres onglets

    app.services.beatTimes = beatTimes;
    app.services.volumeFactors = async (times, influence) => {
      await ensureMusic(false);
      return times.map(t => Audio.intensityFactor(Audio.loudnessAt(M.loud, seqToFile(M.info, t)), influence / 100));
    };
    app.services.musicName = () => (M.info ? M.info.name : '');

    // ---------------------------------------------------------------- actions

    function placeMarkers() {
      return app.runTask('Temps forts', async () => {
        app.status.phase('Lecture de la musique');
        await ensureMusic(false);
        app.status.phase('Détection');
        const times = await beatTimes();
        drawWave();
        if (!times.length) return { kind: 'warn', title: 'Aucun temps fort trouvé', detail: 'Augmente la sensibilité ou change le type de détection.' };
        if (M.info.manual) return { kind: 'warn', title: times.length + ' temps forts détectés', detail: 'Fichier choisi à la main : sa place dans la séquence est inconnue, aucun marqueur posé.' };
        app.status.phase('Pose des marqueurs');
        const b = st().beats;
        const r = await Host.call('addMarkers', { times, name: 'CutFX · ' + MODES.find(m => m.v === b.mode).short, replace: b.replace, from: M.zone.from, to: M.zone.to });
        if (!r.ok) return { kind: 'error', title: 'Marqueurs non posés', detail: r.error };
        app.log(r.added + ' marqueurs posés' + (r.removed ? ', ' + r.removed + ' anciens retirés' : '') + (M.beats.bpm ? ' · ~' + M.beats.bpm + ' BPM' : ''), 'ok');
        return { kind: 'ok', title: app.plural(r.added, 'marqueur posé', 'marqueurs posés'), detail: (M.beats.bpm ? '~' + M.beats.bpm + ' BPM · ' : '') + 'nommés « CutFX · … » (Tout effacer les retire).' };
      });
    }

    async function rhythmTimes() {
      const a = st().autoEdit;
      if (a.source === 'beats') return beatTimes();
      const r = await Host.call('markerList', {});
      if (!r.ok) throw new Error(r.error);
      let t = r.markers.map(m => m.t);
      if (r.range) t = t.filter(x => x >= r.range.a - 1e-6 && x <= r.range.b + 1e-6);
      else t = t.filter(x => x >= r.playhead - 1e-6);
      if (t.length < 2) throw new Error('Il faut au moins deux marqueurs après la tête de lecture (pose les temps forts d\'abord).');
      return t;
    }

    function autoEdit() {
      return app.runTask('Montage auto', async () => {
        app.status.phase('Rushs sélectionnés');
        const pr = await Host.call('projectRushes', {});
        if (!pr.ok) return { kind: 'error', title: 'Montage impossible', detail: pr.error };
        app.status.phase('Rythme');
        const times = await rhythmTimes();
        const a = st().autoEdit;
        const plan = Core.planAutoEdit(times, pr.rushes.map(x => ({ id: x.nodeId, name: x.name, inT: x.inT, outT: x.outT })), { every: a.every, order: a.order, pick: a.pick, seed: Math.floor(Math.random() * 1000) + 1 });
        if (!plan.length) return { kind: 'warn', title: 'Rien à monter', detail: 'Pas assez de temps forts dans la zone.' };
        app.status.phase('Pose des plans');
        const r = await Host.call('placeRushes', { items: plan.map(p => ({ nodeId: p.id, name: pr.rushes[p.rush].name, seqStart: p.seqStart, seqEnd: p.seqEnd, srcIn: p.srcIn })), minTrack: 0, label: 'CutFX · Montage' });
        if (!r.ok) return { kind: 'error', title: 'Montage impossible', detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        if (r.created.length) app.pushHistory({ date: Date.now(), label: 'Montage auto × ' + r.created.length, entries: r.created });
        const short = plan.filter(p => p.short).length;
        return { kind: r.warnings.length || short ? 'warn' : 'ok', title: app.plural(r.created.length, 'plan posé', 'plans posés') + ' sur V' + (r.track + 1), detail: (short ? short + ' rush(s) plus courts que leur créneau · ' : '') + 'vidéo seule, ta musique n\'est pas touchée.' };
      }, true);
    }

    function cutSelection() {
      return app.runTask('Découpe sur le rythme', async () => {
        const r = await Host.call('markerList', {});
        if (!r.ok || !r.markers.length) return { kind: 'error', title: 'Aucun marqueur', detail: 'Pose les temps forts d\'abord.' };
        const c = await Host.call('cutAtTimes', { times: r.markers.map(m => m.t) });
        if (!c.ok) return { kind: 'error', title: 'Découpe impossible', detail: c.error };
        return { kind: c.cuts ? 'ok' : 'warn', title: app.plural(c.cuts, 'coupe', 'coupes'), detail: 'Sur ' + app.plural(c.clips, 'clip sélectionné', 'clips sélectionnés') + ' (et leur son). Ctrl+Z / Cmd+Z pour revenir.' };
      });
    }

    // ---------------------------------------------------------------- synchronisation

    function sync() {
      return app.runTask('Synchronisation', async () => {
        app.status.phase('Sélection');
        const r = await Host.call('syncInfo', {});
        if (!r.ok) return { kind: 'error', title: 'Synchronisation impossible', detail: r.error };
        if (!r.music) return { kind: 'error', title: 'Pas de musique', detail: r.musicError };
        if (!r.clips.length && !r.rushes.length) return { kind: 'error', title: 'Rien à synchroniser', detail: 'Sélectionne des clips dans la timeline, ou des rushs dans le panneau Projet.' };
        app.status.phase('Lecture de la musique');
        await ensureMusic(false);
        const info = M.info;
        if (!M.sync) M.sync = Audio.syncCurve(M.samples, M.sr);
        const fileEnd = seqToFile(info, info.end), list = r.clips.length ? r.clips : r.rushes, moves = [], places = [], lines = [];
        let uncertain = 0;
        for (let i = 0; i < list.length; i++) {
          if (app.S.cancel) break;
          const x = list[i];
          app.status.progress(i, list.length, x.name);
          if (!x.path) { lines.push(x.name + ' : fichier introuvable'); continue; }
          const w0 = r.clips.length ? Math.max(0, x.inPoint - 10) : x.inT;
          const w1 = r.clips.length ? x.inPoint + Math.min(50, Math.max(20, x.end - x.start) + 10) : Math.min(x.outT, x.inT + 60);
          let a;
          try { a = await readAudio(x.path, w0, w1); } catch (e) { lines.push(x.name + ' : ' + app.errorMessage(e)); continue; }
          const dec = decimate(a.samples, a.sampleRate);
          const res = Audio.findOffset(Audio.syncCurve(dec.x, dec.sr), M.sync);
          if (!res || res.score < 0.12 || res.clarity < 1.12) {
            uncertain++;
            lines.push(x.name + ' : son introuvable dans la musique (score ' + (res ? res.score.toFixed(2) : '—') + '), laissé tel quel');
            continue;
          }
          const d = res.offset - a.start; // temps caméra c ↔ temps musique c + d
          if (r.clips.length) {
            if (Math.abs((x.speed || 1) - 1) > 0.001) { lines.push(x.name + ' : vitesse modifiée, non pris en charge'); continue; }
            const delta = fileToSeq(info, x.inPoint + d) - x.start;
            moves.push({ track: x.track, start: x.start, name: x.name, delta });
            lines.push(x.name + ' : ' + (delta >= 0 ? '+' : '') + delta.toFixed(3) + ' s (score ' + res.score.toFixed(2) + ')');
          } else {
            const cA = Math.max(x.inT, info.inPoint - d), cB = Math.min(x.outT, fileEnd - d);
            if (cB - cA < 0.2) { lines.push(x.name + ' : ne recouvre pas la musique de la séquence'); continue; }
            const seqStart = fileToSeq(info, cA + d);
            places.push({ nodeId: x.nodeId, name: x.name, seqStart, seqEnd: seqStart + (cB - cA) / (info.speed || 1), srcIn: cA });
            lines.push(x.name + ' : calé à ' + seqStart.toFixed(2) + ' s (score ' + res.score.toFixed(2) + ')');
          }
        }
        app.status.phase('Placement');
        let done = 0;
        const warnings = [];
        if (moves.length) {
          const m = await Host.call('moveClips', { moves });
          if (!m.ok) return { kind: 'error', title: 'Déplacement impossible', detail: m.error };
          done += m.moved;
          warnings.push.apply(warnings, m.warnings);
        }
        for (const p of places) {
          const pr = await Host.call('placeRushes', { items: [p], minTrack: 0, label: 'CutFX · Synchro' });
          if (!pr.ok) { warnings.push(p.name + ' : ' + pr.error); continue; }
          if (pr.created.length) app.pushHistory({ date: Date.now(), label: 'Synchro · ' + p.name, entries: pr.created });
          warnings.push.apply(warnings, pr.warnings);
          done++;
        }
        lines.forEach(l => app.log('Synchro · ' + l, /introuvable|non pris|laissé|recouvre/.test(l) ? 'warn' : 'ok'));
        warnings.forEach(w => app.log(w, 'warn'));
        renderResults(lines);
        if (!done) return { kind: 'error', title: 'Rien n\'a été synchronisé', detail: lines[0] || warnings[0] || '' };
        return { kind: uncertain || warnings.length ? 'warn' : 'ok', title: app.plural(done, 'clip synchronisé', 'clips synchronisés'), detail: r.clips.length ? 'Déplacés avec leur son sur la musique.' : 'Posés calés sur la musique (vidéo seule), un rush par piste libre.' };
      }, true);
    }

    // ---------------------------------------------------------------- interface

    const MODES = [
      { v: 'kicks', label: 'Grosse caisse (kicks)', short: 'kick' },
      { v: 'hits', label: 'Tous les coups', short: 'coup' },
      { v: 'snares', label: 'Caisse claire et charleston', short: 'snare' },
      { v: 'tempo', label: 'Grille du tempo (chaque temps)', short: 'temps' }
    ];

    let waveCanvas = null, waveInfo = null, resultsBox = null;

    function drawWave() {
      if (!waveCanvas || !waveCanvas.isConnected) return;
      const { g, w, h: hh } = fitCanvas(waveCanvas, 90);
      g.clearRect(0, 0, w, hh);
      g.fillStyle = css('--bg-2');
      g.fillRect(0, 0, w, hh);
      if (!M.loud || !M.info) {
        g.fillStyle = css('--text-3');
        g.font = '12px ' + css('--font');
        g.fillText('Clique sur « Analyser » pour voir la musique et ses temps forts.', 10, hh / 2 + 4);
        return;
      }
      const info = M.info, f0 = info.manual ? 0 : info.inPoint, f1 = info.manual ? M.duration : seqToFile(info, info.end);
      const xOf = t => (t - f0) / Math.max(0.001, f1 - f0) * w, v = M.loud.values, rate = M.loud.rate;
      if (M.zone) {
        g.fillStyle = 'rgba(75,156,245,0.10)';
        const za = xOf(seqToFile(info, M.zone.from)), zb = xOf(seqToFile(info, M.zone.to));
        g.fillRect(za, 0, zb - za, hh);
      }
      g.fillStyle = css('--text-3');
      for (let x = 0; x < w; x++) {
        const a = Math.floor((f0 + x / w * (f1 - f0)) * rate), b = Math.ceil((f0 + (x + 1) / w * (f1 - f0)) * rate);
        let m = 0;
        for (let i = Math.max(0, a); i < Math.min(v.length, b); i++) m = Math.max(m, v[i]);
        const bar = 4 + m * (hh - 12);
        g.fillRect(x, (hh - bar) / 2, 1, bar);
      }
      if (M.beats) {
        g.fillStyle = css('--accent');
        M.beats.times.forEach(t => { const x = xOf(t); if (x >= 0 && x <= w) g.fillRect(Math.round(x), 0, 1.5, hh); });
      }
      if (waveInfo) {
        waveInfo.textContent = info.name + ' · ' + Math.round(M.duration) + ' s' + (M.beats ? ' · ' + app.plural(M.beats.times.length, 'temps fort') + (M.beats.bpm ? ' · ~' + M.beats.bpm + ' BPM' : '') : '');
      }
    }

    async function analyzeNow() {
      await app.runTask('Analyse de la musique', async () => {
        app.status.phase('Lecture du fichier');
        await ensureMusic(true);
        app.status.phase('Détection');
        detect(await zone());
        drawWave();
        return { kind: 'ok', title: 'Musique analysée', detail: app.plural(M.beats.times.length, 'temps fort') + (M.beats.bpm ? ' · ~' + M.beats.bpm + ' BPM' : '') };
      });
    }

    // Réglage modifié : nouvelle détection (instantanée si la musique est déjà analysée).
    function redetect() {
      app.persist();
      if (!M.an) return;
      zone().then(z => { detect(z); drawWave(); }).catch(() => {});
    }

    function chooseFile() {
      const input = h('input', { type: 'file', class: 'hidden', accept: 'audio/*,.wav,.mp3,.aif,.aiff,.m4a,.mov,.mp4' });
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) return;
        app.runTask('Analyse de la musique', async () => {
          await useFile(f);
          detect({ from: 0, to: M.duration });
          drawWave();
          return { kind: 'ok', title: 'Musique analysée', detail: f.name + ' · ' + app.plural(M.beats.times.length, 'temps fort') };
        });
      });
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 60000);
    }

    function renderResults(lines) {
      if (!resultsBox || !resultsBox.isConnected) return;
      resultsBox.innerHTML = '';
      lines.forEach(l => resultsBox.appendChild(h('div', { class: /introuvable|non pris|laissé|recouvre/.test(l) ? 'warn' : 'ok' }, l)));
    }

    function render(view) {
      const s = st(), b = s.beats, a = s.autoEdit;
      view.innerHTML = '';
      waveCanvas = h('canvas', { class: 'wave-canvas' });
      waveInfo = h('div', { class: 'note' });
      const analyze = h('button', { class: 'action' }, 'Analyser');
      analyze.addEventListener('click', analyzeNow);
      const choose = h('button', { class: 'action quiet', title: 'Si la musique de la séquence n\'est pas trouvée, ou hors de Premiere' }, 'Choisir un fichier…');
      choose.addEventListener('click', chooseFile);
      view.appendChild(section('Musique', [
        h('div', { class: 'note' }, 'La musique est le plus long clip son de la séquence, ou le clip son sélectionné.'),
        waveCanvas, waveInfo, h('div', { class: 'row-buttons' }, analyze, choose)
      ]));

      view.appendChild(section('Temps forts', [
        row('Détection', picker(MODES, b.mode, v => { b.mode = v; redetect(); })),
        row('Sensibilité', hotText({ value: b.sensitivity, min: 0, max: 100, step: 1, unit: '%', onChange: (v, fin) => { b.sensitivity = v; if (fin) redetect(); } })),
        row('Écart minimum', hotText({ value: b.minGap, min: 40, max: 2000, step: 10, unit: 'ms', onChange: (v, fin) => { b.minGap = v; if (fin) redetect(); } })),
        row('Garder un temps sur', actionGroup([1, 2, 4, 8].map(n => ({ v: n, label: String(n) })), b.every, v => { b.every = v; redetect(); })),
        row('Zone', picker([
          { v: 'music', label: 'Toute la musique' },
          { v: 'playhead', label: 'Depuis la tête de lecture' },
          { v: 'selection', label: 'Clips sélectionnés' }
        ], b.zone, v => { b.zone = v; redetect(); })),
        h('div', { class: 'field' }, checkbox('Remplacer les marqueurs CutFX de la zone', b.replace, v => { b.replace = v; app.persist(); })),
        h('div', { class: 'note' }, 'Le bouton du haut pose un marqueur sur chaque temps fort : les effets (Position « Marqueurs de la séquence »), les textes et le montage auto s\'en servent.')
      ]));

      const monter = h('button', { class: 'action' }, 'Monter les rushs sélectionnés');
      monter.addEventListener('click', autoEdit);
      const couper = h('button', { class: 'action' }, 'Découper les clips sélectionnés');
      couper.addEventListener('click', cutSelection);
      view.appendChild(section('Montage auto sur le rythme', [
        h('div', { class: 'note' }, 'Sélectionne des rushs dans le panneau Projet : ils sont posés l\'un après l\'autre, un plan par temps fort, sur une piste libre (vidéo seule). Les points d\'entrée/sortie de chaque rush délimitent la partie utilisable.'),
        row('Rythme', picker([{ v: 'markers', label: 'Marqueurs de la séquence' }, { v: 'beats', label: 'Temps forts détectés' }], a.source, v => { a.source = v; app.persist(); })),
        row('Un plan tous les', actionGroup([1, 2, 4, 8].map(n => ({ v: n, label: n + (n > 1 ? ' temps' : ' temps') })), a.every, v => { a.every = v; app.persist(); })),
        row('Ordre', actionGroup([{ v: 'sequence', label: 'Dans l\'ordre' }, { v: 'random', label: 'Au hasard' }], a.order, v => { a.order = v; app.persist(); })),
        row('Extrait', picker([
          { v: 'random', label: 'Au hasard dans le rush' },
          { v: 'start', label: 'Début du rush' },
          { v: 'middle', label: 'Milieu du rush' },
          { v: 'continue', label: 'À la suite (le rush avance)' }
        ], a.pick, v => { a.pick = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, monter, couper),
        h('div', { class: 'note' }, '« Découper » coupe les clips sélectionnés de la timeline (et leur son) à chaque marqueur.')
      ]));

      const syncBtn = h('button', { class: 'action' }, 'Synchroniser la sélection');
      syncBtn.addEventListener('click', sync);
      resultsBox = h('div', { class: 'log' });
      view.appendChild(section('Synchroniser le son et l\'image', [
        h('div', { class: 'note' }, 'Pour un tournage en playback : CutFX compare le son de la caméra avec la musique et cale l\'image dessus. Clips sélectionnés dans la timeline : ils sont déplacés avec leur son. Rushs sélectionnés dans le panneau Projet : ils sont posés calés, chacun sur une piste libre (vidéo seule).'),
        h('div', { class: 'row-buttons' }, syncBtn), resultsBox
      ]));

      const inf = hotText({ value: s.volumeInfluence, min: 0, max: 100, step: 5, unit: '%', onChange: v => { s.volumeInfluence = v; app.persist(); } });
      view.appendChild(section('Volume et intensité', [
        checkbox('L\'intensité des effets suit le volume de la musique', s.volumeFollow, v => { s.volumeFollow = v; app.persist(); }),
        row('Influence', inf),
        h('div', { class: 'note' }, 'Sur un passage calme, l\'effet est plus doux ; sur un drop, plus fort. Aussi réglable dans l\'onglet Effets.')
      ]));
      requestAnimationFrame(drawWave);
    }

    app.tabs.music = { render, cta: () => ({ label: 'Poser les marqueurs des temps forts', run: placeMarkers, enabled: true }), redraw: drawWave };
    app.actions.beats = placeMarkers;
    app.actions.sync = sync;
  });
})(typeof self !== 'undefined' ? self : this);
