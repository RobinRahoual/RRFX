/* RR FX : onglet Parole, pour tout ce qui parle (YouTube, vlogs, interviews, podcasts filmés,
   vidéos d'entreprise, conférences) :
   - Couper les silences : RR FX écoute le son des plans choisis, trouve les blancs et les
     retire en recollant la suite (sur une copie de la séquence par défaut).
   - Zoom visage : un plan sur deux (ou tous) resserré sur les yeux, qui sont suivis : la coupe
     devient un changement de cadre et le regard ne bouge pas.
   - « Euh » et répétitions : repérés dans le son (et dans le .srt), coupés ou marqués.
   - Sous-titres : un .srt / .vtt posé en textes animés, en phrases ou en mots courts, mots clés
     en couleur (et emoji), petit « pop » sonore.
   - Bandeau nom et fonction (lower third).
   - Son de la voix : chaque plan amené à -14 LUFS, débruitage en option.
   - Musique sous la voix : le volume de la musique baisse quand on parle (ducking).
   - Chapitres YouTube : depuis les marqueurs ou les blancs du .srt, prêts à coller. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Sp = root.RRFXSpeech, V = root.RRFXVoix, { Core, Lib, Store, Host } = app;
    const { h, hotText, actionGroup, picker, row, section } = app.UI;

    const DEFAULTS = {
      level: 'normal', minSilence: 0.5, pad: 0.12, mode: 'copy', remap: true,
      faceAmount: 20, faceAlt: true, faceTrack: true, faceFrame: 'keep',
      srt: '', words: 0, capAnim: 'pop', capFrom: 'start',
      name: '', role: '', lowerDur: 5, lowerPos: 'left', lowerAnim: 'slide-up',
      capStyle: '', lowerStyle: '', keys: 'color', keyColor: '#ffd21e', keyList: '', emoji: false, popSound: 'none',
      fillerLevel: 'normal', fillerMode: 'copy',
      voiceTarget: -14, denoise: false, duckDepth: 12, chapSrc: 'markers'
    };
    const NAV = [['silences', '✂ Silences'], ['euh', 'Euh'], ['visage', 'Visage'], ['soustitres', 'Sous-titres'], ['bandeau', 'Bandeau'], ['voix', 'Voix'], ['musique', 'Musique'], ['chapitres', 'Chapitres']];
    const TOOLS = {
      silences: ['Couper les silences', () => cutSilences()], euh: ['Couper les « euh »', () => cutFillers()],
      visage: ['Zoomer sur le visage', () => punchIn()], soustitres: ['Poser les sous-titres', () => captions()],
      bandeau: ['Poser le bandeau', () => lowerThird()], voix: ['Égaliser la voix', () => levelVoice()],
      musique: ['Baisser la musique sous la voix', () => duckMusic()], chapitres: ['Créer les chapitres', () => makeChapters(() => app.switchTab('speech'))]
    };
    const DENOISE = ['DeNoise', 'Réduction du bruit', 'Débruitage', 'Rauschunterdrückung', 'Reducción de ruido', 'Riduzione rumore'];
    const KEY_COLORS = ['#ffd21e', '#ff4d4d', '#2ee6a8', '#38b6ff', '#c77dff'];
    const st = () => {
      // Complète sans remplacer l'objet (l'interface garde une référence dessus).
      const s = app.settings();
      if (!s.speech || typeof s.speech !== 'object') s.speech = {};
      Object.keys(DEFAULTS).forEach(k => { if (!(k in s.speech)) s.speech[k] = DEFAULTS[k]; });
      return s.speech;
    };
    const fmtSecs = t => (t >= 60 ? Math.floor(t / 60) + ' min ' + String(Math.round(t % 60)).padStart(2, '0') + ' s' : t.toFixed(1).replace('.', ',') + ' s');

    // ---------------------------------------------------------------- silences

    let last = null; // dernière analyse { ranges, a, b, clips }
    let lastCuts = []; // coupes faites (silences, euh) : [{ ranges, name }], pour recaler les sous-titres

    async function speechClips() {
      const info = await Host.call('speechInfo', {});
      if (!info.ok) throw new Error(info.error);
      if (!info.clips.length) throw new Error('Sélectionne dans la timeline les plans où l\'on parle (image et son, ou le son seul).');
      return info.clips;
    }

    /* Son d'un plan de la timeline → { samples, sr, toSeq } (toSeq : temps du son → séquence),
       ou null s'il n'a pas de fichier son lisible. */
    async function readClip(c) {
      const dur = (c.end - c.start) * c.speed;
      let samples, sr, t0 = c.inPoint;
      if (app.S.demo) { sr = 16000; samples = Sp.demoSpeech(sr, dur); } else if (!c.path) return null; else {
        const a = await app.services.readAudio(c.path, c.inPoint, c.inPoint + dur);
        samples = a.samples; sr = a.sampleRate; t0 = a.start;
      }
      return { samples, sr, toSeq: t => c.start + (t0 + t - c.inPoint) / c.speed };
    }

    async function analyze() {
      const x = st(), clips = await speechClips(), per = [];
      let mute = 0;
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        app.status.progress(i, clips.length, 'Écoute de ' + c.name);
        const a = await readClip(c);
        if (!a) { mute++; per.push({ start: c.start, end: c.end, silent: [] }); continue; }
        const d = Sp.detect(a.samples, a.sr, { level: x.level, minSilence: x.minSilence, pad: x.pad });
        per.push({ start: c.start, end: c.end, silent: d.ranges.map(r => ({ a: a.toSeq(r.a), b: a.toSeq(r.b) })) });
      }
      if (mute) app.log(app.plural(mute, 'plan sans fichier son lisible', 'plans sans fichier son lisible') + ' (séquence imbriquée ?) : gardés en entier.', 'warn');
      const ranges = Sp.combine(per);
      last = { ranges, a: Math.min(...per.map(p => p.start)), b: Math.max(...per.map(p => p.end)), clips: clips.length, spans: per.map(p => ({ a: p.start, b: p.end })) };
      return last;
    }

    function cutSilences(opts) {
      const x = st(), mode = (opts && opts.mode) || x.mode;
      return app.runTask('Couper les silences', async () => {
        app.status.phase('Écoute du son');
        const r = await analyze();
        draw();
        if (!r.ranges.length) return { kind: 'warn', title: 'Aucun silence trouvé', detail: 'Essaie la sensibilité « Forte » ou un silence minimum plus court.' };
        const sec = Sp.total(r.ranges);
        if (mode === 'markers') {
          const m = await Host.call('addMarkers', { times: r.ranges.map(q => q.a), name: 'RR FX · silence', color: 1 });
          if (!m.ok) return { kind: 'error', title: 'Marqueurs non posés', detail: m.error };
          return { kind: 'ok', title: app.plural(r.ranges.length, 'silence marqué', 'silences marqués'), detail: fmtSecs(sec) + ' de blancs. Un marqueur au début de chaque silence : coupe à ton rythme.' };
        }
        app.status.phase('Coupe et recollage');
        const res = await Host.call('cutSilences', { ranges: r.ranges, copy: mode === 'copy' });
        if (!res.ok) return { kind: 'error', title: 'Silences non coupés', detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        lastCuts.push({ ranges: r.ranges, name: res.name });
        last = null;
        return {
          kind: res.warnings && res.warnings.length ? 'warn' : 'ok',
          title: app.plural(res.ranges, 'silence coupé', 'silences coupés') + ' · ' + fmtSecs(res.seconds) + ' en moins',
          detail: (res.copy ? 'Dans « ' + res.name + ' » : ta séquence d\'origine est intacte.' : 'Ctrl+Z (Cmd+Z) dans Premiere pour revenir en arrière.') + (res.warnings && res.warnings.length ? ' ' + res.warnings[0] : '')
        };
      }, true);
    }

    // ---------------------------------------------------------------- « euh » et répétitions

    /* « Euh » trouvés dans le son des plans choisis, et répétitions du .srt (s'il y en a un).
       → { fillers: [{ a, b }], repeats: [{ a, b, text, exact }] } en temps de séquence. */
    async function findFillers() {
      const x = st(), clips = await speechClips(), fillers = [];
      for (let i = 0; i < clips.length; i++) {
        app.status.progress(i, clips.length, 'Écoute de ' + clips[i].name);
        const a = await readClip(clips[i]);
        if (!a) continue;
        V.fillers(a.samples, a.sr, { level: x.fillerLevel }).forEach(r => fillers.push({ a: Math.max(clips[i].start, a.toSeq(r.a)), b: Math.min(clips[i].end, a.toSeq(r.b)) }));
      }
      let repeats = [];
      const cues = Sp.parseSubtitles(x.srt);
      if (cues.length) repeats = Sp.repeats(cutAware(Sp.offset(cues, await startTime(x.capFrom))));
      return { fillers, repeats };
    }

    // Sous-titres faits avant les coupes (silences, euh) recalés sur la séquence d'aujourd'hui.
    const cutAware = items => lastCuts.reduce((acc, c) => Sp.remap(acc, c.ranges), items);

    function cutFillers() {
      const x = st();
      return app.runTask('« Euh » et répétitions', async () => {
        app.status.phase('Écoute du son');
        const f = await findFillers();
        const exact = f.repeats.filter(r => r.exact), rough = f.repeats.filter(r => !r.exact);
        const cut = f.fillers.concat(exact.map(r => ({ a: r.a, b: r.b }))).sort((p, q) => p.a - q.a);
        if (!cut.length && !rough.length) return { kind: 'warn', title: 'Aucun « euh » trouvé', detail: 'Essaie la sensibilité « Forte ». Les répétitions sont lues dans le .srt (onglet Parole > Sous-titres).' };
        const n = app.plural(f.fillers.length, '« euh »', '« euh »') + (f.repeats.length ? ' et ' + app.plural(f.repeats.length, 'répétition') : '');
        if (x.fillerMode === 'markers' || !cut.length) {
          const all = cut.concat(rough).sort((p, q) => p.a - q.a);
          const m = await Host.call('addMarkers', { times: all.map(r => r.a), name: 'RR FX · euh / répétition', color: 5 });
          if (!m.ok) return { kind: 'error', title: 'Marqueurs non posés', detail: m.error };
          return { kind: 'ok', title: n + ' marqué' + (all.length > 1 ? 's' : ''), detail: 'Un marqueur au début de chacun : vérifie et coupe à ton rythme.' };
        }
        app.status.phase('Coupe et recollage');
        const res = await Host.call('cutSilences', { ranges: cut, copy: x.fillerMode === 'copy', suffix: ' (sans euh)' });
        if (!res.ok) return { kind: 'error', title: 'Rien n\'a été coupé', detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        lastCuts.push({ ranges: cut, name: res.name });
        rough.forEach(r => app.log('Répétition à vérifier (temps estimé) : « ' + r.text + ' »', 'warn'));
        return {
          kind: rough.length || (res.warnings && res.warnings.length) ? 'warn' : 'ok',
          title: n + ' : ' + fmtSecs(res.seconds) + ' en moins',
          detail: (res.copy ? 'Dans « ' + res.name + ' ».' : 'Ctrl+Z dans Premiere pour revenir.') + (rough.length ? ' ' + app.plural(rough.length, 'répétition') + ' à vérifier (sous-titres non découpés mot par mot) : voir le journal.' : '')
        };
      }, true);
    }

    // ---------------------------------------------------------------- son de la voix

    // Chaque plan parlé amené à la même sonie (et débruité en option).
    function levelVoice() {
      const x = st();
      return app.runTask('Son de la voix', async () => {
        const clips = await speechClips(), todo = [], before = [];
        // Un même enregistrement (souvent coupé en morceaux par la coupe des silences) est mesuré
        // en entier et reçoit un seul gain : pas de volume qui saute d'un morceau à l'autre.
        const groups = new Map();
        clips.forEach(c => { const k = c.path || c.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
        let n = 0;
        for (const list of groups.values()) {
          app.status.progress(n++, groups.size, 'Mesure de ' + list[0].name);
          const parts = [];
          let sr = 0;
          for (const c of list) {
            const a = await readClip(c);
            if (a) { parts.push(a.samples); sr = a.sr; }
          }
          if (!parts.length) continue;
          const all = new Float32Array(parts.reduce((s2, q) => s2 + q.length, 0));
          parts.reduce((o, q) => { all.set(q, o); return o + q.length; }, 0);
          const m = V.loudness(all, sr), g = V.gainFor(m, x.voiceTarget, -1);
          if (g.silent) continue;
          before.push(m.lufs);
          if (g.limited) app.log(list[0].name + ' : gain limité à ' + g.gain + ' dB (crêtes déjà hautes)', 'warn');
          list.forEach(c => (c.audio || []).forEach(t => todo.push({ track: t.track, start: t.start, gain: g.gain })));
        }
        if (!todo.length) return { kind: 'warn', title: 'Aucun son à régler', detail: 'Sélectionne des plans avec leur son (image et son liés, ou le son seul).' };
        const r = await Host.call('voiceLevel', { clips: todo, denoise: x.denoise ? DENOISE : null });
        if (!r.ok) return { kind: 'error', title: 'Niveau non réglé', detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        if (r.created.length) app.pushHistory({ date: Date.now(), label: 'Son de la voix', entries: r.created });
        const lo = Math.round(Math.min(...before)), hi = Math.round(Math.max(...before));
        return { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', title: app.plural(r.done, 'son réglé', 'sons réglés') + ' à ' + x.voiceTarget + ' LUFS', detail: 'Avant : ' + (lo === hi ? lo : 'de ' + lo + ' à ' + hi) + ' LUFS.' + (r.cleaned ? ' Débruitage ajouté (réglable dans Options d\'effet).' : '') + ' ↶ Annuler remet le volume d\'avant.' };
      });
    }

    // ---------------------------------------------------------------- musique sous la voix

    function duckMusic() {
      const x = st();
      return app.runTask('Musique sous la voix', async () => {
        app.status.phase('Écoute de la voix');
        const r = await analyze();
        draw();
        // Voix = les plans choisis moins leurs silences.
        const speech = [];
        r.spans.sort((p, q) => p.a - q.a).forEach(sp => {
          let t = sp.a;
          r.ranges.filter(g => g.b > sp.a && g.a < sp.b).forEach(g => { if (g.a > t) speech.push({ a: t, b: g.a }); t = Math.max(t, g.b); });
          if (t < sp.b) speech.push({ a: t, b: sp.b });
        });
        const m = await Host.call('musicInfo', { notSelected: true });
        if (!m.ok) return { kind: 'error', title: 'Pas de musique', detail: m.error || 'Pose ta musique sur une piste audio.' };
        const keys = V.duckKeys(speech, { depth: x.duckDepth, from: m.start, to: m.end });
        if (!keys.length) return { kind: 'warn', title: 'Rien à baisser', detail: 'La voix ne passe pas pendant la musique.' };
        const res = await Host.call('duckMusic', { track: m.track, start: m.start, keys });
        if (!res.ok) return { kind: 'error', title: 'Volume non réglé', detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        app.pushHistory({ date: Date.now(), label: 'Musique sous la voix', entries: res.created });
        return { kind: 'ok', title: 'Musique baissée de ' + x.duckDepth + ' dB sous la voix', detail: app.plural(speech.length, 'passage parlé', 'passages parlés') + ' sur « ' + m.name + ' ». ↶ Annuler remet le volume d\'avant.' };
      });
    }

    // ---------------------------------------------------------------- chapitres YouTube

    let chap = null;
    function makeChapters(refresh) {
      const x = st();
      return app.runTask('Chapitres YouTube', async () => {
        let res;
        if (x.chapSrc === 'markers') {
          const m = await Host.call('markerList', {});
          if (!m.ok) return { kind: 'error', title: 'Marqueurs illisibles', detail: m.error };
          // Les marqueurs posés par RR FX (temps forts, silences) ne sont pas des chapitres.
          const mk = m.markers.filter(q => !/^RR FX · /.test(q.name || '') || /chapitre/i.test(q.name || ''));
          if (!mk.length) return { kind: 'warn', title: 'Aucun marqueur', detail: 'Pose un marqueur nommé au début de chaque partie (touche M, puis double-clic pour le nommer), ou choisis « Sous-titres ».' };
          res = Sp.chapters({ markers: mk });
        } else {
          const cues = Sp.parseSubtitles(x.srt);
          if (!cues.length) return { kind: 'warn', title: 'Pas de sous-titres', detail: 'Importe ton .srt ci-dessus, ou choisis « Marqueurs ».' };
          res = Sp.chapters({ cues: cutAware(Sp.offset(cues, await startTime(x.capFrom))) });
        }
        chap = res;
        refresh();
        return { kind: res.ok ? 'ok' : 'warn', title: app.plural(res.list.length, 'chapitre'), detail: res.ok ? 'Copie-les dans la description YouTube.' : res.why };
      });
    }

    // ---------------------------------------------------------------- punch-in

    // Zoom visage (yeux suivis) ou punch-in centré, sur un plan sur deux ou tous les plans.
    function punchIn() {
      const x = st(), e = app.services.entryByKey(x.faceTrack ? 'b:face-zoom' : 'b:punch-in');
      if (!e) return null;
      const s = app.settings(), keep = { placement: s.placement, alternate: s.alternate, vary: s.vary }, cur = app.S.cur, params = app.S.params;
      Object.assign(s, { placement: 'allclips', alternate: !!x.faceAlt, vary: 'seed' });
      app.S.cur = e;
      app.S.params = Object.assign(app.services.defaultParams(e), { amount: x.faceAmount }, x.faceTrack ? { frame: x.faceFrame } : { frame: 'up' });
      const done = app.actions.applyEffect();
      const restore = () => { Object.assign(s, keep); app.S.cur = cur; app.S.params = params; app.persist(); };
      if (done && done.then) return done.then(v => { restore(); return v; }, err => { restore(); throw err; });
      restore();
      return done;
    }

    // ---------------------------------------------------------------- sous-titres

    async function startTime(from) {
      const m = await Host.call('markerList', {});
      if (!m.ok) throw new Error(m.error);
      if (from === 'playhead') return m.playhead;
      if (from === 'selection') {
        if (!m.range) throw new Error('Sélectionne le plan de départ dans la timeline (ou choisis « Début de la séquence »).');
        return m.range.a;
      }
      return 0;
    }

    // opts.remap : recaler sur la dernière coupe des silences (le .srt vient d'avant la coupe).
    function captions(opts) {
      const x = st(), remap = opts && 'remap' in opts ? opts.remap : x.remap !== false;
      return app.runTask('Sous-titres', async () => {
        const cues = Sp.parseSubtitles(x.srt);
        if (!cues.length) return { kind: 'error', title: 'Pas de sous-titres', detail: 'Importe ou colle un fichier .srt / .vtt (Premiere : Texte > Sous-titres > Exporter en fichier SRT).' };
        if (!app.services.mogrt()) return { kind: 'error', title: 'Choisis un modèle de texte', detail: 'Onglet Textes > Modèle de texte.' };
        const t0 = await startTime(x.capFrom);
        // Mots clés repérés (couleur, emoji) pendant le découpage.
        const marked = x.keys !== 'none' || x.emoji;
        let items = Sp.offset(marked ? Sp.highlight(cues, x.words, { emoji: x.emoji, list: String(x.keyList || '').split(/[,;\n]+/) }) : Sp.splitCues(cues, x.words), t0);
        if (remap && lastCuts.length) { items = cutAware(items); app.log('Sous-titres recalés sur ' + app.plural(lastCuts.length, 'coupe') + ' (' + lastCuts[lastCuts.length - 1].name + ')', 'info'); }
        app.status.phase('Pose des sous-titres');
        const keyFx = x.keys === 'color' ? Core.toWire(Core.compileEffect({ params: [], build: () => [{ type: 'tint', props: { black: [0, 0, 0], white: rgb(x.keyColor), amount: 100 } }] }, {}, 'post', 1, app.fps(), app.registry())) : null;
        const r = await app.services.placeTexts(items, { anim: x.capAnim, label: 'Sous-titres', pos: [0.5, 0.78], keyFx, style: x.capStyle });
        if (r.error) return { kind: 'error', title: 'Sous-titres non posés', detail: r.error };
        // Petit « pop » sonore sur les mots clés ou sur chaque sous-titre.
        let pops = 0;
        if (x.popSound !== 'none' && r.created.length && !app.S.cancel) {
          const times = items.filter(it => x.popSound === 'all' || it.key).map(it => it.start);
          if (times.length) {
            const snd = await Host.call('placeAsset', { kind: 'audio', path: app.services.ensureSound('pop'), name: 'Pop', times });
            if (snd.ok) { pops = snd.created.length; app.pushHistory({ date: Date.now(), label: 'Pops des sous-titres', entries: snd.created }); } else app.log('Pops : ' + snd.error, 'warn');
          }
        }
        const keyCount = items.filter(it => it.key).length;
        return { kind: r.warnings.length ? 'warn' : 'ok', title: app.plural(r.created.length, 'sous-titre posé', 'sous-titres posés') + (r.track !== null ? ' sur V' + (r.track + 1) : ''),
          detail: (marked ? app.plural(keyCount, 'mot clé mis en avant', 'mots clés mis en avant') + (pops ? ', ' + app.plural(pops, 'pop') : '') + '. ' : '') + 'Animation « ' + r.anim.name + ' ». Police : modifie le modèle dans Objets graphiques essentiels.' };
      }, true);
    }

    const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, 'ffd21e']; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

    function importSrt(refresh) {
      const files = Store.pickFiles('Choisir des sous-titres (.srt, .vtt)', ['srt', 'vtt']);
      if (files === null) return app.status.finish('warn', 'Disponible dans Premiere', 'Le choix de fichier passe par Premiere. Ici, colle le texte du .srt.');
      if (!files.length) return null;
      try { st().srt = Store.fs.readFileSync(files[0], 'utf8').replace(/^﻿/, ''); } catch (e) { return app.status.finish('error', 'Fichier illisible', app.errorMessage(e)); }
      app.persist();
      refresh();
      return app.status.finish('ok', app.plural(Sp.parseSubtitles(st().srt).length, 'sous-titre lu', 'sous-titres lus'), Store.path.basename(files[0]));
    }

    // ---------------------------------------------------------------- bandeau

    const LOWER_POS = { left: [0.3, 0.84], center: [0.5, 0.84], top: [0.3, 0.14] };

    function lowerThird() {
      const x = st();
      return app.runTask('Bandeau', async () => {
        const text = [x.name, x.role].map(v => String(v || '').trim()).filter(Boolean).join('\r');
        if (!text) return { kind: 'error', title: 'Écris un nom', detail: 'Le nom (et la fonction) de la personne qui parle.' };
        if (!app.services.mogrt()) return { kind: 'error', title: 'Choisis un modèle de texte', detail: 'Onglet Textes > Modèle de texte.' };
        const t0 = await startTime('playhead');
        const r = await app.services.placeTexts([{ start: t0, end: t0 + x.lowerDur, text }], { anim: x.lowerAnim, label: 'Bandeau', pos: LOWER_POS[x.lowerPos] || LOWER_POS.left, style: x.lowerStyle });
        if (r.error) return { kind: 'error', title: 'Bandeau non posé', detail: r.error };
        return { kind: r.warnings.length ? 'warn' : 'ok', title: 'Bandeau posé · ' + String(x.name || x.role).trim(), detail: x.lowerDur + ' s à la tête de lecture' + (r.track !== null ? ', sur V' + (r.track + 1) : '') + '. Déplace-le comme un clip.' };
      });
    }

    // ---------------------------------------------------------------- interface

    let bar = null;
    function draw() {
      if (!bar || !bar.isConnected) return;
      bar.innerHTML = '';
      if (!last) { bar.appendChild(h('div', { class: 'note' }, 'Sélectionne tes plans, puis « Analyser » : les silences s\'affichent ici avant de couper.')); return; }
      const len = Math.max(1e-6, last.b - last.a), sec = Sp.total(last.ranges);
      const track = h('div', { class: 'sp-track' }, last.ranges.map(r => h('span', { class: 'sp-gap', style: { left: ((r.a - last.a) / len * 100).toFixed(2) + '%', width: Math.max(0.4, (r.b - r.a) / len * 100).toFixed(2) + '%' } })));
      bar.appendChild(track);
      bar.appendChild(h('div', { class: 'note' }, last.ranges.length
        ? app.plural(last.ranges.length, 'silence', 'silences') + ' · ' + fmtSecs(sec) + ' sur ' + fmtSecs(len) + ' (' + Math.round(sec / len * 100) + ' %). En rouge : ce qui sera retiré.'
        : 'Aucun silence avec ces réglages.'));
    }

    function render(view) {
      const x = st();
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'xp-hero' },
        h('div', { class: 'xp-hero-title' }, 'Vidéos qui parlent'),
        h('div', { class: 'xp-hero-text' }, 'YouTube, vlogs, interviews, podcasts, vidéos d\'entreprise : silences et « euh » coupés, zoom visage, sous-titres avec mots clés, son de la voix, musique sous la voix, chapitres.')));

      // Sommaire collant : un clic amène à la section (et la déplie).
      const nav = h('div', { class: 'sec-nav', role: 'navigation', 'aria-label': 'Sections de l\'onglet Parole' });
      NAV.forEach(([k, label]) => {
        const b = h('button', { class: 'action' + (x.lastTool === k ? ' selected' : '') }, label);
        b.addEventListener('click', () => {
          const el = view.querySelector('[data-sec="' + k + '"]');
          if (!el) return;
          if (el.classList.contains('folded')) el.querySelector('.section-title').click();
          const sc = document.getElementById('scroll');
          sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - nav.offsetHeight - 4;
        });
        nav.appendChild(b);
      });
      view.appendChild(nav);

      // Silences
      const analyzeBtn = h('button', { class: 'action' }, 'Analyser');
      analyzeBtn.addEventListener('click', () => app.runTask('Analyse des silences', async () => {
        const r = await analyze();
        draw();
        return { kind: r.ranges.length ? 'ok' : 'warn', title: r.ranges.length ? app.plural(r.ranges.length, 'silence trouvé', 'silences trouvés') + ' · ' + fmtSecs(Sp.total(r.ranges)) : 'Aucun silence trouvé', detail: r.ranges.length ? 'Rien n\'est coupé tant que tu ne cliques pas sur « Couper les silences ».' : 'Essaie la sensibilité « Forte ».' };
      }));
      const cutBtn = h('button', { class: 'action go' }, 'Couper les silences');
      cutBtn.addEventListener('click', use('silences', () => cutSilences()));
      bar = h('div', { class: 'sp-bar' });
      const reset = () => { last = null; draw(); app.persist(); };
      view.appendChild(sec('silences', 'Couper les silences', [
        h('div', { class: 'note' }, 'Sélectionne dans la timeline les plans où l\'on parle (image et son, ou le son seul). RR FX écoute le son, trouve les blancs et les retire en recollant la suite.'),
        row('Sensibilité', actionGroup([{ v: 'soft', label: 'Douce', title: 'Seulement les vrais blancs' }, { v: 'normal', label: 'Normale' }, { v: 'strong', label: 'Forte', title: 'Aussi les respirations et les « euh » faibles' }], x.level, v => { x.level = v; reset(); })),
        row('Silence minimum', hotText({ value: x.minSilence, min: 0.2, max: 3, step: 0.05, unit: 's', onChange: v => { x.minSilence = v; reset(); } }), { title: 'Les pauses plus courtes sont gardées' }),
        row('Marge gardée', hotText({ value: x.pad, min: 0, max: 0.5, step: 0.01, unit: 's', onChange: v => { x.pad = v; reset(); } }), { title: 'Laissée de chaque côté de la voix, pour ne pas couper les mots' }),
        row('Résultat', actionGroup([{ v: 'copy', label: 'Sur une copie', title: 'Une copie « (sans silences) » : ta séquence reste intacte' }, { v: 'cut', label: 'Directement', title: 'Dans la séquence ouverte (Ctrl+Z pour revenir)' }, { v: 'markers', label: 'Marqueurs', title: 'Un marqueur sur chaque silence, rien n\'est coupé' }], x.mode, v => { x.mode = v; app.persist(); })),
        bar,
        h('div', { class: 'row-buttons' }, analyzeBtn, cutBtn),
        h('div', { class: 'note' }, 'À faire avant d\'ajouter musique, plans de coupe et titres : les autres pistes ne sont pas décalées.')
      ]));
      draw();

      // « Euh » et répétitions
      const fillBtn = h('button', { class: 'action go' }, 'Couper les « euh »');
      fillBtn.addEventListener('click', use('euh', cutFillers));
      view.appendChild(sec('euh', '« Euh » et répétitions', [
        h('div', { class: 'note' }, 'RR FX écoute les plans choisis et repère les « euh », « hum » et voyelles tenues entre deux mots. Avec un .srt (section Sous-titres), il trouve aussi les répétitions (« on va, on va ») et les faux départs.'),
        row('Sensibilité', actionGroup([{ v: 'soft', label: 'Douce' }, { v: 'normal', label: 'Normale' }, { v: 'strong', label: 'Forte' }], x.fillerLevel, v => { x.fillerLevel = v; app.persist(); })),
        row('Résultat', actionGroup([{ v: 'copy', label: 'Sur une copie', title: 'Une copie « (sans euh) » : ta séquence reste intacte' }, { v: 'cut', label: 'Directement' }, { v: 'markers', label: 'Marqueurs', title: 'Conseillé pour un premier essai : un marqueur sur chaque « euh »' }], x.fillerMode, v => { x.fillerMode = v; app.persist(); })),
        h('div', { class: 'note' }, 'Les répétitions dont le temps n\'est qu\'estimé (sous-titres de plusieurs mots) sont seulement listées dans le journal, ou marquées.'),
        h('div', { class: 'row-buttons' }, fillBtn)
      ]));

      // Zoom visage
      const punch = h('button', { class: 'action go' }, 'Zoomer sur le visage');
      punch.addEventListener('click', use('visage', punchIn));
      view.appendChild(sec('visage', 'Zoom visage', [
        h('div', { class: 'note' }, 'RR FX trouve le visage dans chaque plan et zoome sur les yeux en les suivant : ils restent à leur place à l\'écran pendant que le cadre se resserre. Après la coupe des silences, un plan sur deux : chaque jump cut devient un changement de cadre.'),
        row('Zoom', hotText({ value: x.faceAmount, min: 5, max: 60, step: 1, unit: '%', onChange: v => { x.faceAmount = v; app.persist(); } })),
        row('Plans', actionGroup([{ v: true, label: 'Un sur deux' }, { v: false, label: 'Tous' }], x.faceAlt, v => { x.faceAlt = v; app.persist(); }), { title: 'Sur tous les plans de la séquence' }),
        row('Yeux', actionGroup([{ v: 'keep', label: 'À leur place' }, { v: 'center', label: 'Recentrés' }], x.faceFrame, v => { x.faceFrame = v; app.persist(); })),
        h('div', { class: 'field' }, app.UI.checkbox('Suivre le visage (sinon : zoom fixe vers le haut du cadre)', x.faceTrack, v => { x.faceTrack = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, punch)
      ]));

      // Sous-titres
      const ta = h('textarea', { class: 'code lyrics', rows: 5, spellcheck: 'false', placeholder: '1\n00:00:01,000 --> 00:00:03,200\nBonjour à tous…' }, x.srt);
      const count = h('div', { class: 'note' });
      const updateCount = () => {
        const cues = Sp.parseSubtitles(x.srt), n = Sp.splitCues(cues, x.words).length;
        count.textContent = cues.length ? app.plural(cues.length, 'sous-titre lu', 'sous-titres lus') + (n !== cues.length ? ' → ' + n + ' textes à l\'écran' : '') + '.' : 'Aucun sous-titre lu.';
      };
      ta.addEventListener('input', () => { x.srt = ta.value; updateCount(); app.persist(); });
      updateCount();
      const imp = h('button', { class: 'action' }, 'Importer un .srt…');
      imp.addEventListener('click', () => importSrt(() => app.switchTab('speech')));
      const capBtn = h('button', { class: 'action go' }, 'Poser les sous-titres');
      capBtn.addEventListener('click', use('soustitres', () => captions()));
      const anims = app.services.titleAnimOptions ? app.services.titleAnimOptions() : Lib.TITLE_ANIMS.map(a => ({ v: a.id, label: a.name }));
      const styles = app.textStyles ? app.textStyles.options() : [{ v: '', label: 'Celui du modèle .mogrt' }];
      const model = app.services.mogrtName ? app.services.mogrtName() : '';
      view.appendChild(sec('soustitres', 'Sous-titres', [
        h('div', { class: 'note' }, 'Un fichier .srt ou .vtt : Premiere le crée (Texte > Transcription, puis Sous-titres > Exporter en fichier SRT), comme la plupart des outils de transcription.'),
        h('div', { class: 'row-buttons' }, imp),
        ta, count,
        row('À l\'écran', actionGroup([{ v: 0, label: 'Phrase entière' }, { v: 3, label: '3 mots' }, { v: 1, label: 'Mot par mot', title: 'Le style TikTok / Reels' }], x.words, v => { x.words = v; updateCount(); app.persist(); })),
        row('Animation', picker(anims, x.capAnim, v => { x.capAnim = v; app.persist(); })),
        row('Style', picker(styles, x.capStyle, v => { x.capStyle = v; app.persist(); }), { title: 'Tes styles se créent dans l\'onglet Textes > Style du texte' }),
        row('Mots clés', actionGroup([{ v: 'color', label: 'En couleur' }, { v: 'none', label: 'Non' }], x.keys, v => { x.keys = v; app.persist(); app.switchTab('speech'); }), { title: 'Chiffres, mots forts, mots en MAJUSCULES ou suivis de « ! », et ta liste' }),
        x.keys === 'color' ? row('Couleur', app.services.colorPick ? app.services.colorPick(x.keyColor, v => { x.keyColor = v || '#ffd21e'; app.persist(); }) : swatches()) : null,
        row('Tes mots', keyListField(), { title: 'Toujours mis en avant (séparés par des virgules)' }),
        h('div', { class: 'field' }, app.UI.checkbox('Emoji après les mots clés (💰 🔥 💡…)', x.emoji, v => { x.emoji = v; app.persist(); })),
        row('Son « pop »', actionGroup([{ v: 'none', label: 'Aucun' }, { v: 'keys', label: 'Mots clés' }, { v: 'all', label: 'Chaque texte' }], x.popSound, v => { x.popSound = v; app.persist(); })),
        row('Départ du .srt', picker([{ v: 'start', label: 'Début de la séquence' }, { v: 'playhead', label: 'Tête de lecture' }, { v: 'selection', label: 'Début des clips sélectionnés' }], x.capFrom, v => { x.capFrom = v; app.persist(); })),
        lastCuts.length ? h('div', { class: 'field' }, app.UI.checkbox('Recaler sur les coupes (silences, euh) : .srt fait avant', x.remap !== false, v => { x.remap = v; app.persist(); })) : null,
        h('div', { class: 'note' }, 'Modèle de texte : ' + (model || 'aucun') + ' (onglet Textes).'),
        h('div', { class: 'row-buttons' }, capBtn)
      ]));

      // Bandeau
      const field = (key, ph) => {
        const inp = h('input', { class: 'textfield', value: x[key], placeholder: ph });
        inp.addEventListener('input', () => { x[key] = inp.value; app.persist(); });
        return inp;
      };
      const lowBtn = h('button', { class: 'action go' }, 'Poser le bandeau');
      lowBtn.addEventListener('click', use('bandeau', lowerThird));
      view.appendChild(sec('bandeau', 'Bandeau nom et fonction', [
        h('div', { class: 'note' }, 'Le nom de la personne qui parle, posé à la tête de lecture (interviews, témoignages, conférences).'),
        row('Nom', field('name', 'Camille Martin')),
        row('Fonction', field('role', 'Directrice marketing')),
        row('Durée', hotText({ value: x.lowerDur, min: 1, max: 30, step: 0.5, unit: 's', onChange: v => { x.lowerDur = v; app.persist(); } })),
        row('Place', actionGroup([{ v: 'left', label: '↙ Bas' }, { v: 'center', label: '↓ Centre' }, { v: 'top', label: '↖ Haut' }], x.lowerPos, v => { x.lowerPos = v; app.persist(); })),
        row('Animation', picker(anims, x.lowerAnim, v => { x.lowerAnim = v; app.persist(); })),
        row('Style', picker(styles, x.lowerStyle, v => { x.lowerStyle = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, lowBtn)
      ]));

      // Son de la voix
      const voiceBtn = h('button', { class: 'action go' }, 'Égaliser la voix');
      voiceBtn.addEventListener('click', use('voix', levelVoice));
      view.appendChild(sec('voix', 'Son de la voix', [
        h('div', { class: 'note' }, 'Chaque plan parlé est mesuré (sonie en LUFS) et amené au même niveau : plus de plan trop faible ou trop fort. Les crêtes restent sous -1 dB.'),
        row('Niveau (LUFS)', actionGroup([{ v: -14, label: '-14 · Web', title: 'YouTube, Instagram, TikTok' }, { v: -16, label: '-16 · Podcast' }, { v: -23, label: '-23 · TV' }], x.voiceTarget, v => { x.voiceTarget = v; app.persist(); })),
        h('div', { class: 'field' }, app.UI.checkbox('Réduire le bruit de fond (effet DeNoise de Premiere)', x.denoise, v => { x.denoise = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, voiceBtn)
      ]));

      // Musique sous la voix
      const duckBtn = h('button', { class: 'action go' }, 'Baisser la musique sous la voix');
      duckBtn.addEventListener('click', use('musique', duckMusic));
      view.appendChild(sec('musique', 'Musique sous la voix', [
        h('div', { class: 'note' }, 'Sélectionne les plans où l\'on parle : la musique de la séquence baisse doucement pendant la voix et remonte dans les pauses (images clés de volume, modifiables).'),
        row('Baisse', hotText({ value: x.duckDepth, min: 3, max: 30, step: 1, unit: 'dB', onChange: v => { x.duckDepth = v; app.persist(); } })),
        h('div', { class: 'row-buttons' }, duckBtn)
      ]));

      // Chapitres YouTube
      const chapBox = h('div');
      const drawChap = () => {
        chapBox.innerHTML = '';
        if (!chap) return;
        const out = h('textarea', { class: 'code', rows: Math.min(12, chap.list.length + 1), readonly: true }, chap.text);
        const copy = h('button', { class: 'action' }, 'Copier');
        copy.addEventListener('click', () => (navigator.clipboard ? navigator.clipboard.writeText(chap.text) : Promise.reject(new Error('presse-papiers indisponible')))
          .then(() => app.status.finish('ok', 'Chapitres copiés', 'Colle-les dans la description de ta vidéo YouTube.'), e => app.status.finish('warn', 'Copie impossible', app.errorMessage(e))));
        const mark = h('button', { class: 'action' }, 'Poser les marqueurs');
        mark.addEventListener('click', () => app.runTask('Marqueurs de chapitre', async () => {
          for (const c of chap.list) {
            const m = await Host.call('addMarkers', { times: [c.t], name: 'RR FX · Chapitre · ' + c.title, color: 4 });
            if (!m.ok) return { kind: 'error', title: 'Marqueurs non posés', detail: m.error };
          }
          return { kind: 'ok', title: app.plural(chap.list.length, 'marqueur de chapitre', 'marqueurs de chapitre'), detail: 'Renomme-les dans Premiere si besoin : RR FX les relit.' };
        }));
        chapBox.appendChild(out);
        if (chap.why) chapBox.appendChild(h('div', { class: 'note' }, chap.why));
        chapBox.appendChild(h('div', { class: 'row-buttons' }, copy, x.chapSrc === 'srt' ? mark : null));
      };
      const chapBtn = h('button', { class: 'action go' }, 'Créer les chapitres');
      chapBtn.addEventListener('click', use('chapitres', () => makeChapters(drawChap)));
      view.appendChild(sec('chapitres', 'Chapitres YouTube', [
        h('div', { class: 'note' }, 'La liste « 00:00 Titre » à coller dans la description : depuis tes marqueurs nommés, ou depuis les grands blancs du .srt (le début de la phrase suivante sert de titre).'),
        row('Depuis', actionGroup([{ v: 'markers', label: 'Les marqueurs' }, { v: 'srt', label: 'Les sous-titres' }], x.chapSrc, v => { x.chapSrc = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, chapBtn),
        chapBox
      ]));
      drawChap();
    }

    // Section repérée par une clé (sommaire, dernier outil utilisé).
    const sec = (key, title, body) => { const el = section(title, body); el.dataset.sec = key; return el; };
    // Le bouton bleu du haut reprend le dernier outil utilisé de l'onglet.
    const use = (key, fn) => () => { st().lastTool = key; app.persist(); app.renderCTA(); return fn(); };

    function swatches() {
      const x = st(), box = h('div', { class: 'key-colors' });
      KEY_COLORS.forEach(c => {
        const b = h('button', { class: 'key-color' + (x.keyColor === c ? ' on' : ''), style: { background: c }, title: c, 'aria-label': 'Couleur ' + c });
        b.addEventListener('click', () => { x.keyColor = c; app.persist(); box.querySelectorAll('.key-color').forEach(q => q.classList.toggle('on', q === b)); });
        box.appendChild(b);
      });
      return box;
    }
    function keyListField() {
      const x = st(), inp = h('input', { class: 'textfield', value: x.keyList, placeholder: 'formation, gratuit, Robin' });
      inp.addEventListener('input', () => { x.keyList = inp.value; app.persist(); });
      return inp;
    }

    app.actions.cutSilences = cutSilences;
    app.actions.captions = captions;
    app.actions.lowerThird = lowerThird;
    app.actions.punchIn = punchIn;
    app.actions.cutFillers = cutFillers;
    app.actions.levelVoice = levelVoice;
    app.actions.duckMusic = duckMusic;
    app.actions.chapters = () => makeChapters(() => { if (app.S.tab === 'speech') app.switchTab('speech'); });
    app.services.speechClips = async () => { const r = await Host.call('speechInfo', {}).catch(() => ({ ok: false })); return r.ok ? r.clips.length : 0; };
    app.services.hasCaptions = () => Sp.parseSubtitles(st().srt).length;
    app.services.hasLowerThird = () => !!String(st().name || '').trim();
    app.tabs.speech = { render, cta: () => { const t = TOOLS[st().lastTool] || TOOLS.silences; return { label: t[0], run: t[1], enabled: true }; }, leave: () => {} };
  });
})(typeof self !== 'undefined' ? self : this);
