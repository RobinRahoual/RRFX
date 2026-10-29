/* RR FX : les fonctions qui s'appuient sur les outils gratuits installés en option (Réglages ›
   Outils gratuits). Chaque outil est proposé à l'installation au premier usage.
   - Parole › Podcast multicam : la caméra de celui qui parle (un micro par personne, ou un seul
     micro et sherpa-onnx), plan large quand on parle à deux ou dans les blancs ;
   - Parole › Débruiter la voix (DeepFilterNet) et Voix off témoin (Piper) ;
   - Musique › Séparer les pistes (Demucs), et temps forts sur la batterie seule ;
   - Textes › Texte derrière le sujet (rembg) ;
   - Rampe › Ralenti fluide (RIFE) ; Bibliothèque › Agrandir un plan (Real-ESRGAN).
   Ce qui est fabriqué (sons, vidéos) est rangé dans Documents/RRFX/Fabriqué, importé dans le projet
   et posé dans la timeline ; ↶ Annuler le retire. Calculs : podcast.js, libres.js. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Lb = root.RRFXLibres, Pc = root.RRFXPodcast, Sons = root.RRFXSons, W = root.RRFXWhisper, L = root.RRFXLiens, { Store, Host } = app;
    const { h, row, actionGroup, picker, checkbox, hotText } = app.UI;
    const T = () => app.tools;
    const st = () => {
      const s = app.settings();
      if (!s.libres || typeof s.libres !== 'object') s.libres = {};
      const d = {
        pcMode: 'mics', pcPeople: 0, pcMin: 2, pcWide: 'auto', pcSens: 'normal',
        dnLevel: 'natural', voText: '', voVoice: Lb.VOICES[0].id, voSpeed: 1,
        stems: 'vocals', stemMute: true, cutMax: 20, slow: 4, up: 2
      };
      Object.keys(d).forEach(k => { if (!(k in s.libres)) s.libres[k] = d[k]; });
      return s.libres;
    };
    // Dossier des fichiers fabriqués (ils restent : le projet Premiere s'en sert).
    const outDir = sub => { const d = Store.path.join(Store.dir, 'Fabriqué', sub); Store.fs.mkdirSync(d, { recursive: true }); return d; };
    const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const base = n => L.safeName(String(n || 'plan').replace(/\.[a-z0-9]{2,5}$/i, ''), 'plan');
    const onlyPremiere = () => !Store.fs ? { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('Cet outil tourne sur ton ordinateur, depuis Premiere (mode démo ici).') } : null;

    async function selected(kind) {
      const info = await Host.call('speechInfo', {});
      if (!info.ok) throw new Error(info.error);
      return { fps: info.fps, clips: info.clips.filter(c => !kind || c.kind === kind) };
    }
    // Le plan vidéo choisi (le premier de la sélection), avec son média.
    async function oneVideo(why) {
      const s = await selected('video'), c = s.clips[0];
      if (!c) throw T().warn(_T('Sélectionne un plan vidéo'), why);
      if (!c.path) throw new Error(_T('Fichier de « ') + c.name + _T(' » introuvable (séquence imbriquée ?).'));
      return { c, fps: s.fps };
    }
    async function place(kind, path, t, extra) {
      const r = await Host.call('placeAsset', Object.assign({ kind, path, name: Store.path.basename(path), times: [t] }, extra || {}));
      if (!r.ok) throw new Error(r.error);
      (r.warnings || []).forEach(w => app.log(w, 'warn'));
      return r.created;
    }

    // ---------------------------------------------------------------- podcast multicam

    const SENS = { soft: 0.6, normal: 0.45, strong: 0.3 };
    // Niveau d'un micro (une piste) sur la grille [lo, hi] de la séquence, 10 valeurs par seconde.
    async function micLevels(clips, lo, hi) {
      const n = Math.max(1, Math.round((hi - lo) / Pc.STEP)), grid = new Float32Array(n).fill(-120);
      for (const c of clips) {
        const a = await app.speech.readClip(c);
        if (!a) continue;
        const lv = Pc.levels(a.samples, a.sr);
        for (let i = 0; i < lv.length; i++) {
          const k = Math.round((a.toSeq(i * Pc.STEP) - lo) / Pc.STEP);
          if (k >= 0 && k < n) grid[k] = lv[i];
        }
      }
      return grid;
    }
    // Un seul micro : qui parle, d'après sherpa-onnx. → { frames, people }
    async function turnsOf(c, lo, hi, people) {
      const exe = await T().need('diarize', _T('sherpa-onnx reconnaît les voix, même avec un seul micro.'));
      const m = await T().models('diarize'), a = await app.speech.readClip(c);
      if (!a) throw new Error(_T('Son illisible : ') + c.name);
      const dir = T().work('voix'), wav = Store.path.join(dir, 'micro.wav');
      try {
        Store.fs.writeFileSync(wav, Buffer.from(Sons.wav(W.to16k(a.samples, a.sr), 16000)));
        app.status.phase(_T('Qui parle (sherpa-onnx)'));
        const cpus = (() => { try { return Store.nodeRequire('os').cpus().length; } catch (e) { return 4; } })();
        const r = await T().run(exe, Lb.diarizeArgs({ segmentation: m.segmentation, embedding: m.embedding, num: people, wav, threads: Math.max(1, Math.min(8, cpus - 1)) }));
        const turns = Lb.parseDiarization(r.out + '\n' + r.err).map(t => ({ a: a.toSeq(t.a) - lo, b: a.toSeq(t.b) - lo, speaker: t.speaker }));
        if (!turns.length) throw new Error(_T('Aucune voix reconnue dans ') + c.name);
        return Pc.fromTurns(turns, hi - lo);
      } finally { T().clean(dir); }
    }

    function podcast() {
      const x = st();
      return app.runTask(_T('Podcast multicam'), async () => {
        if (app.S.demo) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('Le podcast multicam écoute les vrais micros de ta séquence.') };
        const s = await selected();
        const vids = s.clips.filter(c => c.kind === 'video'), cams = Array.from(new Set(vids.map(c => c.track))).sort((a, b) => a - b);
        if (cams.length < 2) return { kind: 'warn', title: _T('Sélectionne les caméras'), detail: _T('Les plans de deux caméras ou plus, synchronisés et empilés (une piste par caméra), et les sons des micros.') };
        const lo = Math.min(...s.clips.map(c => c.start)), hi = Math.max(...s.clips.map(c => c.end));
        // Plan large : choisi, ou la dernière caméra s'il y a plus de caméras que de personnes.
        let wide = x.pcWide === 'none' ? -1 : x.pcWide === 'auto' ? null : cams.indexOf(+x.pcWide);
        let frames, people, from;
        if (x.pcMode === 'one') {
          const mics = s.clips.filter(c => c.kind === 'audio'), src = (mics.length ? mics : vids).slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
          const d = await turnsOf(src, lo, hi, x.pcPeople);
          frames = d.frames; people = d.people; from = _T('sherpa-onnx (') + src.name + ')';
        } else {
          // Un micro par piste son ; sans micro séparé, le son de chaque caméra.
          const byTrack = (list, key) => { const m = new Map(); list.forEach(c => { const k = key(c); if (!m.has(k)) m.set(k, []); m.get(k).push(c); }); return Array.from(m.entries()).sort((a, b) => a[0] - b[0]); };
          let mics = byTrack(s.clips.filter(c => c.kind === 'audio'), c => c.track), label = 'A';
          if (mics.length < 2) {
            if (wide === null && cams.length > 2) wide = cams.length - 1;
            mics = byTrack(vids.filter(c => wide === null || wide < 0 || c.track !== cams[wide]), c => c.track);
            label = 'V';
          }
          if (mics.length < 2) return { kind: 'warn', title: _T('Deux micros au moins'), detail: _T('Sélectionne aussi le son de chaque micro (une piste par personne), ou choisis « Un seul micro ».') };
          const grids = [];
          for (let i = 0; i < mics.length; i++) {
            app.status.progress(i, mics.length, _T('Écoute du micro ') + label + (mics[i][0] + 1));
            grids.push(await micLevels(mics[i][1], lo, hi));
          }
          frames = Pc.speakers(grids, { sens: SENS[x.pcSens] || 0.45 });
          people = mics.length;
          from = mics.map(m => label + (m[0] + 1)).join(', ');
        }
        if (wide === null) wide = cams.length > people ? cams.length - 1 : -1;
        const others = cams.map((c, i) => i).filter(i => i !== wide), map = others.slice(0, people);
        const plan = Pc.camPlan(Pc.shots(frames, { minShot: x.pcMin, wide: wide >= 0 }), map, wide, lo);
        if (plan.length < 2) return { kind: 'warn', title: _T('Une seule personne entendue'), detail: _T('Vérifie que chaque micro est bien sélectionné, ou essaie la sensibilité « Forte ».') };
        app.status.phase(_T('Changements de caméra'));
        const r = await Host.call('multicamSwitch', { plan: plan.map(p => ({ t: p.t, cam: p.cam })) });
        if (!r.ok) return { kind: 'error', title: _T('Montage multicam impossible'), detail: r.error };
        app.pushHistory({ date: Date.now(), label: _T('Podcast multicam × ') + r.segments, entries: [r.entry] });
        const talk = Pc.talkTime(frames, people), total = talk.reduce((a, b) => a + b, 0) || 1;
        const who = map.map((cam, k) => _T('personne ') + (k + 1) + ' → V' + (cams[cam] + 1) + ' (' + Math.round(talk[k] / total * 100) + ' %)').join(', ');
        return { kind: 'ok', title: app.plural(r.segments, _T('plan'), _T('plans')) + ' · ' + app.plural(people, _T('personne')), detail: who + (wide >= 0 ? _T(' ; plan large V') + (cams[wide] + 1) : '') + _T('. Voix lues sur ') + from + _T('. Les autres caméras sont désactivées, ↶ Annuler les réactive.') };
      }, true);
    }

    app.extras.speech.push({
      id: 'podcast', title: _T('Podcast multicam'), nav: _T('Podcast'), tool: [_T('Monter le podcast'), () => podcast()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Monter le podcast'));
        go.addEventListener('click', podcast);
        return [
          h('div', { class: 'note' }, _T('Sélectionne les plans des caméras (une piste par caméra, synchronisées) et le son de chaque micro. RR FX montre la caméra de celui qui parle, et le plan large quand on parle à deux.')),
          row(_T('Micros'), actionGroup([{ v: 'mics', label: _T('Un par personne') }, { v: 'one', label: _T('Un seul (IA)') }], x.pcMode, v => { x.pcMode = v; app.persist(); })),
          row(_T('Personnes'), hotText({ value: x.pcPeople, min: 0, max: 8, step: 1, unit: '', onChange: v => { x.pcPeople = v; app.persist(); } }), { title: _T('Un seul micro : nombre de personnes (0 : deviné)') }),
          row(_T('Plan large'), picker([{ v: 'auto', label: _T('Automatique (caméra en plus)') }, { v: 'none', label: _T('Aucun') }].concat([0, 1, 2, 3, 4, 5].map(i => ({ v: String(i), label: 'V' + (i + 1) }))), String(x.pcWide), v => { x.pcWide = v; app.persist(); })),
          row(_T('Plan min.'), hotText({ value: x.pcMin, min: 0.8, max: 8, step: 0.1, unit: 's', onChange: v => { x.pcMin = v; app.persist(); } })),
          row(_T('Sensibilité'), actionGroup([{ v: 'soft', label: _T('Douce') }, { v: 'normal', label: _T('Normale') }, { v: 'strong', label: _T('Forte') }], x.pcSens, v => { x.pcSens = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go),
          h('div', { class: 'note' }, _T('Personne 1 = le micro (ou la caméra) de la piste la plus basse ; elle va sur la caméra de la piste la plus basse, et ainsi de suite. « Un seul micro » utilise sherpa-onnx (installé au premier usage).'))
        ];
      }
    });

    // ---------------------------------------------------------------- débruiter la voix

    const ATTEN = { light: 18, natural: 30, full: 100 };
    function denoise() {
      const x = st();
      return app.runTask(_T('Débruiter la voix (IA)'), async () => {
        const no = onlyPremiere(); if (no) return no;
        const s = await selected(), clips = s.clips.filter(c => c.path);
        if (!clips.length) return { kind: 'warn', title: _T('Sélectionne les plans parlés'), detail: _T('Image et son, ou le son seul.') };
        const exe = await T().need('deepfilter', _T('DeepFilterNet enlève le bruit de fond de la voix.'));
        const dir = outDir(_T('Voix débruitées')), created = [], mute = [];
        let n = 0;
        for (const c of clips) {
          if (app.S.cancel) break;
          if (Math.abs(c.speed - 1) > 0.001) { app.log(c.name + _T(' : vitesse modifiée, plan laissé tel quel.'), 'warn'); continue; }
          app.status.phase(_T('Débruitage de ') + c.name + ' (' + (++n) + '/' + clips.length + ')');
          const tmp = T().work('debruit'), wav = Store.path.join(tmp, base(c.name) + '.wav');
          try {
            try { await T().audioOf(c.path, { start: c.inPoint, dur: c.end - c.start, rate: 48000, channels: 1, out: wav }); } catch (e) {
              if (app.S.cancel) throw e;
              app.log(c.name + _T(' : son illisible (') + app.errorMessage(e) + ')', 'warn');
              continue;
            }
            const outTmp = Store.path.join(tmp, 'out');
            await T().run(exe, Lb.deepFilterArgs({ out: outTmp, input: wav, atten: ATTEN[x.dnLevel] || 30 }));
            const done = Store.path.join(dir, base(c.name) + _T(' (débruité) ') + stamp() + '.wav');
            Store.fs.copyFileSync(Store.path.join(outTmp, Store.path.basename(wav)), done);
            created.push(...await place('audio', done, c.start));
            mute.push(...(c.audio || []).map(a => ({ track: a.track, start: a.start, gain: -96 })));
          } finally { T().clean(tmp); }
        }
        if (mute.length) {
          const r = await Host.call('voiceLevel', { clips: mute });
          if (r.ok) created.push(...r.created); else app.log(r.error, 'warn');
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: _T('Voix débruitée × ') + n, entries: created });
        return { kind: created.length ? 'ok' : 'warn', title: app.plural(n, _T('plan débruité'), _T('plans débruités')), detail: _T('La voix propre est posée sur une piste libre, le son d\'origine coupé (pas supprimé). ↶ Annuler remet tout comme avant.') };
      }, true);
    }

    // ---------------------------------------------------------------- voix off témoin

    function voiceOver() {
      const x = st();
      return app.runTask(_T('Voix off témoin'), async () => {
        const no = onlyPremiere(); if (no) return no;
        const text = String(x.voText || '').trim();
        if (!text) return { kind: 'warn', title: _T('Écris le texte'), detail: _T('Une phrase par ligne : une petite pause est faite entre deux phrases.') };
        const exe = await T().need('piper', _T('Piper lit ton texte avec une voix de synthèse.'));
        const v = Lb.VOICES.find(q => q.id === x.voVoice) || Lb.VOICES[0];
        const model = await T().voice(v), tmp = T().work('voix-off'), txt = Store.path.join(tmp, 'texte.txt');
        const out = Store.path.join(outDir(_T('Voix off')), _T('Voix off ') + stamp() + '.wav');
        try {
          Store.fs.writeFileSync(txt, text.replace(/([.!?…])\s+/g, '$1\n').split(/\n+/).map(l => l.trim()).filter(Boolean).join('\n'), 'utf8');
          app.status.phase(_T('Lecture du texte (Piper)'));
          await T().run(exe, Lb.piperArgs({ model, out, text: txt }).concat(['--length-scale', String(Math.round(100 / (x.voSpeed || 1)) / 100)]));
        } finally { T().clean(tmp); }
        const m = await Host.call('markerList', {});
        const created = await place('audio', out, m.ok ? m.playhead : 0);
        app.pushHistory({ date: Date.now(), label: _T('Voix off témoin'), entries: created });
        return { kind: 'ok', title: _T('Voix off posée'), detail: _T('À la tête de lecture, sur une piste libre. Pratique pour caler le montage avant d\'enregistrer la vraie voix.') };
      }, true);
    }

    app.extras.speech.push({
      id: 'debruiter', title: _T('Débruiter la voix (IA)'), nav: _T('Débruiter'), tool: [_T('Débruiter la voix'), () => denoise()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Débruiter la voix'));
        go.addEventListener('click', denoise);
        return [
          h('div', { class: 'note' }, _T('Souffle, clim, rue, vent : DeepFilterNet garde la voix et enlève le reste, bien mieux qu\'un filtre classique. Sélectionne les plans parlés.')),
          row(_T('Force'), actionGroup([{ v: 'light', label: _T('Légère') }, { v: 'natural', label: _T('Naturelle') }, { v: 'full', label: _T('Totale') }], x.dnLevel, v => { x.dnLevel = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });

    app.extras.speech.push({
      id: 'voixoff', title: _T('Voix off témoin (IA)'), nav: _T('Voix off'), tool: [_T('Créer la voix off'), () => voiceOver()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Créer la voix off'));
        go.addEventListener('click', voiceOver);
        const ta = h('textarea', { class: 'code', rows: 4, placeholder: _T('Le texte de la voix off, une phrase par ligne…') }, x.voText);
        ta.addEventListener('input', () => { x.voText = ta.value; app.persist(); });
        return [
          h('div', { class: 'note' }, _T('Une voix de synthèse naturelle (Piper) lit ton texte, posée à la tête de lecture : pour caler un montage avant d\'enregistrer la vraie voix.')),
          ta,
          row(_T('Voix'), picker(Lb.VOICES.map(v => ({ v: v.id, label: _T(v.label) })), x.voVoice, v => { x.voVoice = v; app.persist(); })),
          row(_T('Débit'), hotText({ value: x.voSpeed, min: 0.6, max: 1.6, step: 0.05, unit: '×', onChange: v => { x.voSpeed = v; app.persist(); } })),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });

    // ---------------------------------------------------------------- séparer les pistes (Demucs)

    const STEM_LABELS = () => ({ vocals: _T('Voix'), no_vocals: _T('Sans la voix'), drums: _T('Batterie'), bass: _T('Basse'), other: _T('Autres instruments') });
    let lastStems = null;
    function separate(keep) {
      const x = st();
      return app.runTask(_T('Séparer les pistes (IA)'), async () => {
        const no = onlyPremiere(); if (no) return no;
        const info = await Host.call('musicInfo', {});
        if (!info.ok) return { kind: 'warn', title: _T('Aucun son choisi'), detail: info.error };
        if (!info.path) return { kind: 'error', title: _T('Fichier introuvable'), detail: info.name };
        const exe = await T().need('demucs', _T('Demucs sépare la voix, la batterie, la basse et le reste.'));
        const dur = (info.end - info.start) * (info.speed || 1), tmp = T().work('pistes'), wav = Store.path.join(tmp, 'source.wav');
        const dir = outDir(_T('Pistes séparées')), name = base(info.name) + ' ' + stamp(), made = {};
        try {
          app.status.phase(_T('Lecture du son'));
          await T().audioOf(info.path, { start: info.inPoint, dur, rate: 44100, channels: 2, out: wav });
          app.status.phase(_T('Séparation (Demucs, quelques minutes)'));
          await T().run(exe, Lb.demucsArgs({ out: tmp, input: wav, two: x.stems === 'vocals' ? 'vocals' : '' }), { label: 'Demucs', progress: Lb.percentOf });
          const found = Store.listFiles(tmp, /\.wav$/i, 50, 4).filter(f => f !== wav);
          found.forEach(f => {
            const stem = Store.path.basename(f, '.wav'), to = Store.path.join(dir, name + ' · ' + (STEM_LABELS()[stem] || stem) + '.wav');
            Store.fs.copyFileSync(f, to);
            made[stem] = to;
          });
        } finally { T().clean(tmp); }
        if (!Object.keys(made).length) throw new Error(_T('Demucs n\'a rien produit.'));
        lastStems = made;
        const created = [], want = keep || (x.stems === 'vocals' ? ['vocals', 'no_vocals'] : Object.keys(made));
        for (const k of want) if (made[k]) created.push(...await place('audio', made[k], info.start));
        if (x.stemMute && created.length) {
          const r = await Host.call('voiceLevel', { clips: [{ track: info.track, start: info.start, gain: -96 }] });
          if (r.ok) created.push(...r.created); else app.log(r.error, 'warn');
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: _T('Pistes séparées · ') + info.name, entries: created });
        return { kind: 'ok', title: app.plural(Object.keys(made).length, _T('piste séparée'), _T('pistes séparées')), detail: _T('Posées sous « ') + info.name + _T(' », calées dessus') + (x.stemMute ? _T(', le son d\'origine coupé') : '') + _T('. Fichiers dans Documents/RRFX/Fabriqué. Coupe le volume d\'une piste pour l\'enlever.') };
      }, true);
    }
    function drumsBeats() {
      return app.runTask(_T('Temps forts sur la batterie'), async () => {
        if (!lastStems || !lastStems.drums || !Store.fs.existsSync(lastStems.drums)) return { kind: 'warn', title: _T('Sépare d\'abord en 4 pistes'), detail: _T('Choisis « 4 pistes » puis « Séparer », sur la musique de la séquence.') };
        await app.music.useStem(lastStems.drums);
        return { kind: 'ok', title: _T('Analyse sur la batterie'), detail: _T('Les temps forts (marqueurs, montage, effets) sont cherchés dans la batterie seule. « Analyser la musique » revient au morceau.') };
      });
    }

    app.extras.music.push({
      id: 'separer', title: _T('Séparer les pistes (IA)'), nav: _T('Pistes'), tool: [_T('Séparer'), () => separate()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Séparer'));
        go.addEventListener('click', () => separate());
        const drums = h('button', { class: 'action' }, _T('Temps forts sur la batterie'));
        drums.addEventListener('click', drumsBeats);
        return [
          h('div', { class: 'note' }, _T('Demucs sépare le son choisi (clip son sélectionné, sinon la musique) : garder la voix d\'un rush sans la musique, enlever la voix d\'un morceau, ou caler les temps forts sur la batterie seule.')),
          row(_T('Pistes'), actionGroup([{ v: 'vocals', label: _T('Voix / reste') }, { v: 'all', label: _T('4 pistes') }], x.stems, v => { x.stems = v; app.persist(); })),
          h('div', { class: 'field' }, checkbox(_T('Couper le son d\'origine'), x.stemMute, v => { x.stemMute = v; app.persist(); })),
          h('div', { class: 'row-buttons wrap' }, go, drums)
        ];
      }
    });

    // ---------------------------------------------------------------- images d'un plan (ffmpeg)

    // Images du passage utilisé d'un plan, dans un dossier de travail. → { dir, files, fps }
    async function framesOf(c, o) {
      const ff = await T().need('ffmpeg', _T('ffmpeg découpe le plan en images.'));
      const info = await T().probe(c.path), dir = Store.path.join(T().work('images'), 'in');
      Store.fs.mkdirSync(dir, { recursive: true });
      const dur = Math.min((o && o.max) || Infinity, (c.end - c.start) * (c.speed || 1));
      app.status.phase(_T('Images du plan'));
      await T().run(ff, Lb.ffFrames(c.path, dir, { start: c.inPoint, dur, fps: o && o.fps }), { label: _T('Images du plan'), progress: l => Lb.ffProgress(l, dur) });
      const files = T().listDir(dir, /\.png$/i);
      if (!files.length) throw new Error(_T('Aucune image lue dans ') + c.name);
      return { dir, files, fps: (o && o.fps) || info.fps || 25, dur, work: Store.path.dirname(dir) };
    }
    // Outils ncnn (RIFE, Real-ESRGAN) : carte graphique (Vulkan), sinon le processeur.
    async function ncnn(exe, args, out, total, label) {
      const stop = T().watchCount(out, total, label);
      try {
        try { await T().run(exe, args, { cwd: Store.path.dirname(exe) }); } catch (e) {
          if (app.S.cancel) throw e;
          app.log(label + _T(' : carte graphique indisponible (') + app.errorMessage(e) + _T('), calcul sur le processeur.'), 'warn');
          T().listDir(out).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e2) { /* déjà parti */ } });
          await T().run(exe, args.concat(['-g', '-1']), { cwd: Store.path.dirname(exe) });
        }
      } finally { stop(); }
    }

    // ---------------------------------------------------------------- texte derrière le sujet

    function cutout() {
      const x = st();
      return app.runTask(_T('Texte derrière le sujet'), async () => {
        const no = onlyPremiere(); if (no) return no;
        const { c, fps } = await oneVideo(_T('Le plan où apparaît la personne (le titre passera derrière elle).'));
        const exe = await T().need('rembg', _T('rembg détoure la personne, image par image.'));
        const f = await framesOf(c, { fps, max: x.cutMax });
        try {
          const out = Store.path.join(f.work, 'out');
          Store.fs.mkdirSync(out, { recursive: true });
          app.status.phase(_T('Détourage (rembg)'));
          const stop = T().watchCount(out, f.files.length, _T('Détourage'));
          try { await T().run(exe, Lb.rembgArgs({ input: f.dir, output: out })); } finally { stop(); }
          const mov = Store.path.join(outDir(_T('Détourages')), base(c.name) + _T(' (détouré) ') + stamp() + '.mov');
          app.status.phase(_T('Vidéo transparente'));
          await T().run(await T().find('ffmpeg'), Lb.ffEncode(out, mov, { fps: f.fps, alpha: true }));
          const created = await place('video', mov, c.start, { dur: f.dur });
          app.pushHistory({ date: Date.now(), label: _T('Détourage · ') + c.name, entries: created });
        } finally { T().clean(f.work); }
        return { kind: 'ok', title: _T('Sujet détouré'), detail: _T('Posé au-dessus de tout. Mets ton titre sur une piste entre le plan et le détourage : il passe derrière la personne.') + (f.dur < (c.end - c.start) - 0.05 ? _T(' Seules les ') + x.cutMax + _T(' premières secondes ont été détourées.') : '') };
      }, true);
    }
    app.extras.titles.push({
      id: 'detourage', title: _T('Texte derrière le sujet (IA)'), nav: _T('Détourage'), tool: [_T('Détourer le sujet'), () => cutout()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Détourer le sujet'));
        go.addEventListener('click', cutout);
        return [
          h('div', { class: 'note' }, _T('L\'effet des Reels : le titre passe derrière la personne. Sélectionne le plan, RR FX détoure la personne (rembg) et pose une copie transparente au-dessus.')),
          row(_T('Durée max.'), hotText({ value: x.cutMax, min: 2, max: 60, step: 1, unit: 's', onChange: v => { x.cutMax = v; app.persist(); } }), { title: _T('Le détourage prend environ une seconde par image') }),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });

    // ---------------------------------------------------------------- ralenti fluide (RIFE)

    function smoothSlow() {
      const x = st();
      return app.runTask(_T('Ralenti fluide (IA)'), async () => {
        const no = onlyPremiere(); if (no) return no;
        const { c } = await oneVideo(_T('Le plan à ralentir.'));
        const exe = await T().need('rife', _T('RIFE invente les images intermédiaires du ralenti.'));
        const models = Store.fs.readdirSync(Store.path.dirname(exe)).filter(n => /^rife-v4/.test(n)).sort();
        const model = Store.path.join(Store.path.dirname(exe), models.indexOf('rife-v4.6') >= 0 ? 'rife-v4.6' : models.pop() || 'rife-v4.6');
        const f = await framesOf(c, {});
        try {
          const out = Store.path.join(f.work, 'out'), count = f.files.length * x.slow;
          Store.fs.mkdirSync(out, { recursive: true });
          app.status.phase(_T('Images intermédiaires (RIFE)'));
          await ncnn(exe, Lb.rifeArgs({ input: f.dir, output: out, count, model }), out, count, 'RIFE');
          const mp4 = Store.path.join(outDir(_T('Ralentis')), base(c.name) + ' (×' + x.slow + _T(' fluide) ') + stamp() + '.mp4');
          app.status.phase(_T('Vidéo du ralenti'));
          await T().run(await T().find('ffmpeg'), Lb.ffEncode(out, mp4, { fps: f.fps }));
          const created = await place('video', mp4, c.start);
          app.pushHistory({ date: Date.now(), label: _T('Ralenti fluide · ') + c.name, entries: created });
          return { kind: 'ok', title: _T('Ralenti ×') + x.slow + _T(' prêt'), detail: _T('Posé au-dessus du plan, ') + Math.round(f.dur * x.slow * 10) / 10 + _T(' s (sans le son). Raccourcis-le à ton goût.') };
        } finally { T().clean(f.work); }
      }, true);
    }
    app.extras.ramp.push({
      id: 'ralenti', title: _T('Ralenti fluide (IA)'), nav: _T('Ralenti'), tool: [_T('Créer le ralenti'), () => smoothSlow()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Créer le ralenti'));
        go.addEventListener('click', smoothSlow);
        return [
          h('div', { class: 'note' }, _T('Un vrai ralenti sans saccade, même filmé à 25 ou 30 i/s : RIFE invente les images qui manquent. Sélectionne le plan (court de préférence).')),
          row(_T('Ralenti'), actionGroup([{ v: 2, label: '×2' }, { v: 4, label: '×4' }, { v: 8, label: '×8' }], x.slow, v => { x.slow = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });

    // ---------------------------------------------------------------- agrandir (Real-ESRGAN)

    function upscale() {
      const x = st();
      return app.runTask(_T('Agrandir un plan (IA)'), async () => {
        const no = onlyPremiere(); if (no) return no;
        const { c } = await oneVideo(_T('Le plan en basse définition à agrandir.'));
        const exe = await T().need('realesrgan', _T('Real-ESRGAN agrandit l\'image en gardant les détails.'));
        const f = await framesOf(c, {});
        try {
          const out = Store.path.join(f.work, 'out');
          Store.fs.mkdirSync(out, { recursive: true });
          app.status.phase(_T('Agrandissement (Real-ESRGAN)'));
          await ncnn(exe, Lb.esrganArgs({ input: f.dir, output: out, models: Store.path.join(Store.path.dirname(exe), 'models') }), out, f.files.length, 'Real-ESRGAN');
          const mp4 = Store.path.join(outDir(_T('Agrandis')), base(c.name) + ' (×' + x.up + ') ' + stamp() + '.mp4');
          app.status.phase(_T('Vidéo agrandie'));
          await T().run(await T().find('ffmpeg'), Lb.ffEncode(out, mp4, { fps: f.fps, scale: x.up / 4 }));
          const created = await place('video', mp4, c.start);
          app.pushHistory({ date: Date.now(), label: _T('Agrandi · ') + c.name, entries: created });
          return { kind: 'ok', title: _T('Plan agrandi ×') + x.up, detail: _T('Posé au-dessus de l\'original (image seule), dans Documents/RRFX/Fabriqué.') };
        } finally { T().clean(f.work); }
      }, true);
    }
    app.extras.assets.push({
      id: 'agrandir', title: _T('Agrandir un plan (IA)'), nav: _T('Agrandir'), tool: [_T('Agrandir'), () => upscale()],
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, _T('Agrandir'));
        go.addEventListener('click', upscale);
        return [
          h('div', { class: 'note' }, _T('Un vieux 720p, une capture d\'écran, un zoom fort : Real-ESRGAN agrandit le plan sélectionné en recréant les détails. Lent : à réserver aux plans courts.')),
          row(_T('Taille'), actionGroup([{ v: 2, label: '×2' }, { v: 4, label: '×4' }], x.up, v => { x.up = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });

    Object.assign(app.actions, { podcast: () => podcast(), denoiseAI: () => denoise(), voiceOver: () => voiceOver(), separate: () => separate(), cutout: () => cutout(), smoothSlow: () => smoothSlow(), upscale: () => upscale() });
  });
})(typeof self !== 'undefined' ? self : this);
