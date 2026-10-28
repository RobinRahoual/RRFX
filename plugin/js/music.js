/* RR FX : onglet Musique : temps forts, montage auto sur le rythme, synchronisation
   son / image, et volume de la musique pour l'intensité des effets. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Core, Audio, Media, Store, Host } = app;
    const { h, hotText, actionGroup, picker, checkbox, row, section, fitCanvas, css } = app.UI;
    // t0 : début (s, temps du fichier) de la partie analysée ; les temps de l'analyse en partent.
    const M = { info: null, manual: null, key: '', samples: null, sr: 0, t0: 0, duration: 0, an: null, loud: null, sync: null, beats: null, zone: null };
    app.S.music = M;

    const DEFAULTS = {
      beats: { mode: 'kicks', sensitivity: 50, minGap: 120, every: 1, zone: 'music', replace: true },
      autoEdit: { source: 'markers', every: 2, order: 'sequence', pick: 'random' },
      sync: { ref: 'music', camRef: 'longest' }
    };
    // Complète les réglages sans remplacer les objets (l'interface garde des références dessus).
    const st = () => {
      const s = app.settings();
      ['beats', 'autoEdit', 'sync'].forEach(k => {
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

    // En-têtes déjà lus (un long rush lu minute par minute n'est analysé qu'une fois).
    const probes = new Map();
    async function probeOf(io, src) {
      const key = typeof src === 'string' ? src + ':' + (await io.size()) : src;
      let info = probes.get(key);
      if (!info) {
        info = await Media.probe(io);
        probes.set(key, info);
        if (probes.size > 8) probes.delete(probes.keys().next().value);
      }
      return info;
    }

    // Le son mono de [t0, t1] (secondes du fichier ; t1 = null : jusqu'à la fin).
    async function readAudio(src, t0, t1) {
      const io = ioFor(src);
      t0 = Math.max(0, t0 || 0);
      try {
        const info = await probeOf(io, src);
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

    const bpmText = () => String(M.beats.bpm).replace('.', ',');
    const seqToFile = (info, t) => info.inPoint + (t - info.start) * (info.speed || 1);
    const fileToSeq = (info, t) => info.start + (t - info.inPoint) / (info.speed || 1);

    // La musique de la séquence, lue et analysée une fois (puis gardée en mémoire). Seule la
    // partie utilisée dans la séquence est lue : un long mix n'est pas chargé en entier.
    async function ensureMusic(force) {
      let info;
      if (M.manual && !M.info.manual) {
        // Fichier choisi à la main, calé sur le clip musique : on suit le clip s'il a bougé ;
        // si la musique de la séquence a changé, on revient à elle.
        const r = await Host.call('musicInfo', {});
        if (r.ok && r.name === M.info.seqName) M.info = Object.assign({}, M.info, { start: r.start, end: r.end, inPoint: r.inPoint, speed: r.speed, track: r.track });
        else if (r.ok && r.path) M.manual = null;
      }
      if (M.manual) info = M.info;
      else {
        const r = await Host.call('musicInfo', {});
        if (!r.ok) throw new Error(r.error);
        info = r;
        if (!info.path) throw new Error('Fichier de « ' + info.name + ' » introuvable : choisis-le à la main (Musique > Choisir un fichier).');
      }
      const w0 = M.manual ? 0 : Math.max(0, info.inPoint - 2), w1 = M.manual ? null : seqToFile(info, info.end) + 2;
      const key = M.manual ? 'file:' + M.manual.name + ':' + M.manual.size : info.path + '#' + w0.toFixed(2) + '-' + w1.toFixed(2);
      if (!force && M.an && M.key === key) { M.info = info; return M; }
      const d = await readAudio(M.manual || info.path, w0, w1);
      const dec = decimate(d.samples, d.sampleRate);
      if (!dec.x.length) throw new Error('Aucun son lisible dans « ' + info.name + ' » à cet endroit.');
      Object.assign(M, { info, key, samples: dec.x, sr: dec.sr, t0: d.start, duration: d.duration, sync: null, beats: null });
      M.an = Audio.analyze(dec.x, dec.sr, 100);
      M.loud = Audio.loudnessCurve(M.an);
      app.log('Musique analysée : ' + info.name + ' (' + Math.round(dec.x.length / dec.sr) + ' s lues)', 'ok');
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

    // Temps forts de la zone ; M.beats.times est en secondes du fichier.
    function detect(z) {
      const b = st().beats, info = M.info;
      M.zone = z;
      const r = Audio.detectBeats(M.an, {
        mode: b.mode, sensitivity: b.sensitivity, minGap: b.minGap / 1000, every: b.every,
        from: seqToFile(info, z.from) - M.t0, to: seqToFile(info, z.to) - M.t0
      });
      M.beats = Object.assign({}, r, { times: r.times.map(t => t + M.t0) });
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
      return times.map(t => Audio.intensityFactor(Audio.loudnessAt(M.loud, seqToFile(M.info, t) - M.t0), influence / 100));
    };
    app.services.musicName = () => (M.info ? M.info.name : '');
    app.services.tempo = async () => { await ensureMusic(false); detect(await zone()); return M.beats.bpm; };

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
        const r = await Host.call('addMarkers', { times, name: 'RR FX · ' + MODES.find(m => m.v === b.mode).short, replace: b.replace, from: M.zone.from, to: M.zone.to });
        if (!r.ok) return { kind: 'error', title: 'Marqueurs non posés', detail: r.error };
        app.log(r.added + ' marqueurs posés' + (r.removed ? ', ' + r.removed + ' anciens retirés' : '') + (M.beats.bpm ? ' · ~' + bpmText() + ' BPM' : ''), 'ok');
        return { kind: 'ok', title: app.plural(r.added, 'marqueur posé', 'marqueurs posés'), detail: (M.beats.bpm ? '~' + bpmText() + ' BPM · ' : '') + 'nommés « RR FX · … » (Tout effacer les retire).' };
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
        const r = await Host.call('placeRushes', { items: plan.map(p => ({ nodeId: p.id, name: pr.rushes[p.rush].name, seqStart: p.seqStart, seqEnd: p.seqEnd, srcIn: p.srcIn })), minTrack: 0, label: 'RR FX · Montage' });
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

    // Courbe de synchro d'un fichier entre t0 et t1 (s), lue par morceaux d'une minute :
    // les longs rushs de caméra ne sont jamais chargés en entier.
    async function curveOf(path, t0, t1) {
      const parts = [];
      let t = t0, dur = Infinity;
      while (t < Math.min(t1, dur) - 0.05) {
        if (app.S.cancel) break;
        const to = Math.min(t1, t + 60), a = await readAudio(path, Math.max(0, t - 1), to);
        dur = a.duration;
        if (!a.samples.length) break;
        const dec = decimate(a.samples, a.sampleRate);
        parts.push(Audio.syncCurvePart(dec.x, dec.sr, Math.max(0, t - a.start)));
        t = to;
      }
      return { curve: Audio.joinCurves(parts), start: t0 };
    }

    // Où se trouve le son du clip x dans la référence. Renvoie d (temps du fichier de x + d =
    // temps du fichier de référence) et le score, ou { error }.
    async function matchClip(x, onTimeline, ref) {
      const w0 = onTimeline ? Math.max(0, x.inPoint - 10) : x.inT;
      const w1 = onTimeline ? x.inPoint + Math.min(50, Math.max(20, x.end - x.start) + 10) : Math.min(x.outT, x.inT + 60);
      let a;
      try { a = await readAudio(x.path, w0, w1); } catch (e) { return { error: app.errorMessage(e) }; }
      const dec = decimate(a.samples, a.sampleRate);
      const res = Audio.findOffset(Audio.syncCurve(dec.x, dec.sr), ref.curve);
      if (!res || res.score < 0.12 || res.clarity < 1.12) return { uncertain: true, score: res ? res.score : 0 };
      return { d: res.offset + ref.start - a.start, score: res.score };
    }

    const CAM_WINDOW = 2400; // au plus 40 min de la caméra de référence

    function sync() {
      return app.runTask('Synchronisation', async () => {
        const cfg = st().sync, byCamera = cfg.ref === 'camera';
        app.status.phase('Sélection');
        const r = await Host.call('syncInfo', {});
        if (!r.ok) return { kind: 'error', title: 'Synchronisation impossible', detail: r.error };
        const onTimeline = r.clips.length > 0, list = onTimeline ? r.clips : r.rushes;
        if (!list.length) return { kind: 'error', title: 'Rien à synchroniser', detail: 'Sélectionne des clips dans la timeline, ou des rushs dans le panneau Projet.' };

        let info, ref, refItem = null, fileEnd = Infinity;
        const moves = [], places = [], lines = [];
        if (!byCamera) {
          if (!r.music && !M.manual) return { kind: 'error', title: 'Pas de musique', detail: r.musicError + ' (ou choisis « Caler sur : une des caméras »).' };
          app.status.phase('Lecture de la musique');
          await ensureMusic(false);
          info = M.info;
          if (info.manual) return { kind: 'error', title: 'Place de la musique inconnue', detail: 'Le fichier choisi à la main n\'est calé sur aucun clip de la séquence : pose la musique dans la séquence, ou choisis « Caler sur : une des caméras ».' };
          if (!M.sync) M.sync = Audio.syncCurve(M.samples, M.sr);
          ref = { curve: M.sync, start: M.t0 };
          fileEnd = seqToFile(info, info.end);
        } else {
          if (list.length < 2) return { kind: 'error', title: 'Une seule caméra', detail: 'Sélectionne les plans de deux caméras ou plus (timeline ou panneau Projet).' };
          const len = x => (onTimeline ? x.end - x.start : x.outT - x.inT);
          refItem = list.slice().sort((p, q) => (cfg.camRef === 'lowest' && onTimeline ? p.track - q.track || p.start - q.start : len(q) - len(p)))[0];
          if (!refItem.path) return { kind: 'error', title: 'Référence illisible', detail: 'Fichier de « ' + refItem.name + ' » introuvable.' };
          if (onTimeline) {
            info = { start: refItem.start, inPoint: refItem.inPoint, speed: refItem.speed || 1, end: refItem.end };
          } else {
            const m = await Host.call('markerList', {});
            const ph = m.ok ? m.playhead : 0;
            info = { start: ph, inPoint: refItem.inT, speed: 1, end: ph + len(refItem) };
            places.push({ nodeId: refItem.nodeId, name: refItem.name, seqStart: ph, seqEnd: info.end, srcIn: refItem.inT, audio: true });
            lines.push(refItem.name + ' : référence, posée à la tête de lecture avec son son');
          }
          app.status.phase('Lecture de la caméra de référence « ' + refItem.name + ' »');
          const r0 = onTimeline ? Math.max(0, refItem.inPoint - 300) : refItem.inT;
          const r1 = Math.min(r0 + CAM_WINDOW, onTimeline ? refItem.outPoint + 300 : refItem.outT);
          try { ref = await curveOf(refItem.path, r0, r1); } catch (e) { return { kind: 'error', title: 'Référence illisible', detail: refItem.name + ' : ' + app.errorMessage(e) }; }
          if (app.S.cancel) return { kind: 'warn', title: 'Arrêté', detail: 'Rien n\'a été déplacé.' };
          if (onTimeline) lines.push(refItem.name + ' : référence (ne bouge pas)');
        }

        const todo = list.filter(x => x !== refItem);
        let uncertain = 0;
        app.status.phase('Comparaison des sons');
        for (let i = 0; i < todo.length; i++) {
          if (app.S.cancel) break;
          const x = todo[i];
          app.status.progress(i, todo.length, x.name);
          if (!x.path) { lines.push(x.name + ' : fichier introuvable'); continue; }
          let d, score = 1;
          if (byCamera && x.path === refItem.path) d = 0; // même fichier : déjà calé
          else {
            const m = await matchClip(x, onTimeline, ref);
            if (m.error) { lines.push(x.name + ' : ' + m.error); continue; }
            if (m.uncertain) {
              uncertain++;
              lines.push(x.name + ' : son introuvable dans la ' + (byCamera ? 'caméra de référence' : 'musique') + ' (score ' + m.score.toFixed(2) + '), laissé tel quel');
              continue;
            }
            d = m.d; score = m.score;
          }
          if (onTimeline) {
            if (Math.abs((x.speed || 1) - 1) > 0.001) { lines.push(x.name + ' : vitesse modifiée, non pris en charge'); continue; }
            const delta = fileToSeq(info, x.inPoint + d) - x.start;
            moves.push({ track: x.track, start: x.start, name: x.name, delta });
            lines.push(x.name + ' : ' + (delta >= 0 ? '+' : '') + delta.toFixed(3) + ' s (score ' + score.toFixed(2) + ')');
          } else {
            // Musique : seule la partie qui recouvre la musique. Caméras : tout le rush.
            let cA = byCamera ? x.inT : Math.max(x.inT, info.inPoint - d);
            const cB = byCamera ? x.outT : Math.min(x.outT, fileEnd - d);
            let seqStart = fileToSeq(info, cA + d);
            if (seqStart < 0) { cA -= seqStart * (info.speed || 1); seqStart = 0; }
            if (cB - cA < 0.2) { lines.push(x.name + ' : ne recouvre pas ' + (byCamera ? 'la référence' : 'la musique de la séquence')); continue; }
            places.push({ nodeId: x.nodeId, name: x.name, seqStart, seqEnd: seqStart + (cB - cA) / (info.speed || 1), srcIn: cA });
            lines.push(x.name + ' : calé à ' + seqStart.toFixed(2) + ' s (score ' + score.toFixed(2) + ')');
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
        const label = byCamera ? 'RR FX · Multicam' : 'RR FX · Synchro';
        for (const p of places) {
          const pr = await Host.call('placeRushes', { items: [p], minTrack: 0, label });
          if (!pr.ok) { warnings.push(p.name + ' : ' + pr.error); continue; }
          if (pr.created.length) app.pushHistory({ date: Date.now(), label: (byCamera ? 'Multicam · ' : 'Synchro · ') + p.name, entries: pr.created });
          warnings.push.apply(warnings, pr.warnings);
          done++;
        }
        lines.forEach(l => app.log('Synchro · ' + l, /introuvable|non pris|laissé|recouvre/.test(l) ? 'warn' : 'ok'));
        warnings.forEach(w => app.log(w, 'warn'));
        renderResults(lines);
        if (!done) return { kind: 'error', title: 'Rien n\'a été synchronisé', detail: lines.find(l => /introuvable|non pris|laissé|recouvre/.test(l)) || warnings[0] || '' };
        const how = byCamera
          ? (onTimeline ? 'Calés sur « ' + refItem.name + ' », déplacés avec leur son. Ensuite : « Alterner les caméras » ou Imbriquer > Activer le multicaméra.' : 'Une caméra par piste, calées sur « ' + refItem.name + ' » (posée avec son son).')
          : (onTimeline ? 'Déplacés avec leur son sur la musique.' : 'Posés calés sur la musique (vidéo seule), un rush par piste libre.');
        return { kind: uncertain || warnings.length ? 'warn' : 'ok', title: app.plural(done, 'clip synchronisé', 'clips synchronisés'), detail: how };
      }, true);
    }

    // Montage multicam : à chaque temps (marqueurs ou temps forts), une seule caméra reste active.
    function multicam() {
      return app.runTask('Montage multicam', async () => {
        const a = st().autoEdit;
        app.status.phase('Rythme');
        const times = (await rhythmTimes()).filter((t, i) => i % Math.max(1, a.every) === 0);
        app.status.phase('Alternance des caméras');
        const r = await Host.call('multicamSwitch', { times, order: a.order === 'random' ? 'random' : 'cycle', seed: Math.floor(Math.random() * 100000) + 1 });
        if (!r.ok) return { kind: 'error', title: 'Montage multicam impossible', detail: r.error };
        app.pushHistory({ date: Date.now(), label: 'Multicam × ' + r.segments, entries: [r.entry] });
        app.log('Multicam : ' + r.segments + ' plans, ' + r.cams + ' caméras, ' + r.disabled + ' passages désactivés', 'ok');
        return { kind: 'ok', title: app.plural(r.segments, 'plan', 'plans') + ' · ' + r.cams + ' caméras', detail: 'Les autres caméras sont désactivées (pas supprimées). ↶ Annuler les réactive.' };
      });
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
      // Jamais au-delà de la fin du fichier (clip plus long que le son, ou fichier choisi à la main).
      const info = M.info, f0 = info.manual ? 0 : info.inPoint, f1 = Math.min(M.duration || Infinity, info.manual ? M.duration : seqToFile(info, info.end));
      const xOf = t => (t - f0) / Math.max(0.001, f1 - f0) * w, v = M.loud.values, rate = M.loud.rate;
      if (M.zone) {
        g.fillStyle = 'rgba(75,156,245,0.10)';
        const za = xOf(seqToFile(info, M.zone.from)), zb = xOf(seqToFile(info, M.zone.to));
        g.fillRect(za, 0, zb - za, hh);
      }
      g.fillStyle = css('--text-3');
      for (let x = 0; x < w; x++) {
        const a = Math.floor((f0 - M.t0 + x / w * (f1 - f0)) * rate), b = Math.ceil((f0 - M.t0 + (x + 1) / w * (f1 - f0)) * rate);
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
        waveInfo.textContent = info.name + ' · ' + Math.round(M.duration) + ' s' + (M.beats ? ' · ' + app.plural(M.beats.times.length, 'temps fort') + (M.beats.bpm ? ' · ~' + bpmText() + ' BPM' : '') : '');
      }
    }

    async function analyzeNow() {
      await app.runTask('Analyse de la musique', async () => {
        app.status.phase('Lecture du fichier');
        await ensureMusic(true);
        app.status.phase('Détection');
        detect(await zone());
        drawWave();
        return { kind: 'ok', title: 'Musique analysée', detail: app.plural(M.beats.times.length, 'temps fort') + (M.beats.bpm ? ' · ~' + bpmText() + ' BPM' : '') };
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
          detect(await zone());
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
        h('div', { class: 'field' }, checkbox('Remplacer les marqueurs RR FX de la zone', b.replace, v => { b.replace = v; app.persist(); })),
        h('div', { class: 'note' }, 'Le bouton du haut pose un marqueur sur chaque temps fort : les effets (Position « Marqueurs de la séquence »), les textes et le montage auto s\'en servent.')
      ]));

      const monter = h('button', { class: 'action' }, 'Monter les rushs sélectionnés');
      monter.addEventListener('click', autoEdit);
      const couper = h('button', { class: 'action' }, 'Découper les clips sélectionnés');
      couper.addEventListener('click', cutSelection);
      const mcBtn = h('button', { class: 'action', title: 'Caméras synchronisées et empilées (une piste par caméra) : sélectionne-les, une seule reste active à chaque temps' }, 'Alterner les caméras (multicam)');
      mcBtn.addEventListener('click', multicam);
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
        h('div', { class: 'row-buttons' }, mcBtn),
        h('div', { class: 'note' }, '« Découper » coupe les clips sélectionnés de la timeline (et leur son) à chaque marqueur. « Alterner les caméras » : sélectionne tes caméras synchronisées, empilées une par piste ; à chaque temps une seule reste active, les autres sont désactivées (rien n\'est supprimé), dans l\'ordre des pistes ou au hasard.')
      ]));

      const syncBtn = h('button', { class: 'action' }, 'Synchroniser la sélection');
      syncBtn.addEventListener('click', sync);
      resultsBox = h('div', { class: 'log' });
      const sc = s.sync, byCam = sc.ref === 'camera';
      view.appendChild(section('Synchroniser le son et l\'image', [
        row('Caler sur', actionGroup([{ v: 'music', label: 'La musique / le son externe' }, { v: 'camera', label: 'Une des caméras' }], sc.ref, v => { sc.ref = v; app.persist(); render(view); })),
        byCam ? row('Caméra de référence', picker([{ v: 'longest', label: 'Le plan le plus long' }, { v: 'lowest', label: 'La piste la plus basse (V1, V2…)' }], sc.camRef, v => { sc.camRef = v; app.persist(); })) : null,
        h('div', { class: 'note' }, byCam
          ? 'Plusieurs caméras : RR FX compare leurs sons et les cale sur la caméra de référence, qui ne bouge pas. Clips sélectionnés dans la timeline (une piste par caméra) : déplacés avec leur son. Rushs sélectionnés dans le panneau Projet : la référence est posée à la tête de lecture avec son son, les autres caméras au-dessus, une par piste.'
          : 'Pour un tournage en playback : RR FX compare le son de la caméra avec la musique (ou le son d\'un enregistreur externe posé dans la séquence) et cale l\'image dessus. Clips sélectionnés dans la timeline : déplacés avec leur son. Rushs sélectionnés dans le panneau Projet : posés calés, chacun sur une piste libre (vidéo seule).'),
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
    app.actions.autoEdit = autoEdit;
  });
})(typeof self !== 'undefined' ? self : this);
