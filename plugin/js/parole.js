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
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Sp = root.RRFXSpeech, V = root.RRFXVoix, { Core, Lib, Store, Host } = app;
    const { h, hotText, actionGroup, picker, row, section } = app.UI;

    const DEFAULTS = {
      level: 'normal', minSilence: 0.5, pad: 0.12, mode: 'copy', remap: true,
      faceAmount: 20, faceAlt: true, faceTrack: true, faceFrame: 'keep',
      srt: '', words: 0, capAnim: 'pop', capFrom: 'start',
      name: '', role: '', lowerDur: 5, lowerPos: 'left', lowerAnim: 'slide-up',
      capStyle: '', lowerStyle: '', keys: 'color', keyColor: '#ffd21e', keyList: '', emoji: false, popSound: 'none', popId: 'auto', popVol: 0,
      fillerLevel: 'normal', fillerMode: 'copy',
      voiceTarget: -14, denoise: false, duckDepth: 12, chapSrc: 'markers'
    };
    const NAV = [['silences', '✂ Silences'], ['euh', _T('Euh')], ['visage', _T('Visage')], ['soustitres', _T('Sous-titres')], ['bandeau', _T('Bandeau')], ['voix', _T('Voix')], ['musique', _T('Musique')], ['chapitres', _T('Chapitres')]];
    // Outils ajoutés par d'autres modules (respirations, plans de coupe, traduction…).
    const extras = () => app.extras.speech;
    const TOOLS = {
      silences: [_T('Couper les silences'), () => cutSilences()], euh: [_T('Couper les « euh »'), () => cutFillers()],
      visage: [_T('Zoomer sur le visage'), () => punchIn()], soustitres: [_T('Poser les sous-titres'), () => captions()],
      bandeau: [_T('Poser le bandeau'), () => lowerThird()], voix: [_T('Égaliser la voix'), () => levelVoice()],
      musique: [_T('Baisser la musique sous la voix'), () => duckMusic()], chapitres: [_T('Créer les chapitres'), () => makeChapters(() => app.switchTab('speech'))]
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
      if (!info.clips.length) throw new Error(_T('Sélectionne dans la timeline les plans où l\'on parle (image et son, ou le son seul).'));
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
        app.status.progress(i, clips.length, _T('Écoute de ') + c.name);
        const a = await readClip(c);
        if (!a) { mute++; per.push({ start: c.start, end: c.end, silent: [] }); continue; }
        const d = Sp.detect(a.samples, a.sr, { level: x.level, minSilence: x.minSilence, pad: x.pad });
        per.push({ start: c.start, end: c.end, silent: d.ranges.map(r => ({ a: a.toSeq(r.a), b: a.toSeq(r.b) })) });
      }
      if (mute) app.log(app.plural(mute, _T('plan sans fichier son lisible'), _T('plans sans fichier son lisible')) + _T(' (séquence imbriquée ?) : gardés en entier.'), 'warn');
      const ranges = Sp.combine(per);
      last = { ranges, a: Math.min(...per.map(p => p.start)), b: Math.max(...per.map(p => p.end)), clips: clips.length, spans: per.map(p => ({ a: p.start, b: p.end })) };
      return last;
    }

    function cutSilences(opts) {
      const x = st(), mode = (opts && opts.mode) || x.mode;
      return app.runTask(_T('Couper les silences'), async () => {
        app.status.phase(_T('Écoute du son'));
        const r = await analyze();
        draw();
        if (!r.ranges.length) return { kind: 'warn', title: _T('Aucun silence trouvé'), detail: _T('Essaie la sensibilité « Forte » ou un silence minimum plus court.') };
        const sec = Sp.total(r.ranges);
        if (mode === 'markers') {
          const m = await Host.call('addMarkers', { times: r.ranges.map(q => q.a), name: 'RR FX · silence', color: 1 });
          if (!m.ok) return { kind: 'error', title: _T('Marqueurs non posés'), detail: m.error };
          return { kind: 'ok', title: app.plural(r.ranges.length, _T('silence marqué'), _T('silences marqués')), detail: fmtSecs(sec) + _T(' de blancs. Un marqueur au début de chaque silence : coupe à ton rythme.') };
        }
        if (mode !== 'copy' && app.versions) await app.versions.beforeCut(_T('avant silences'));
        app.status.phase(_T('Coupe et recollage'));
        const res = await Host.call('cutSilences', { ranges: r.ranges, copy: mode === 'copy', suffix: _T(' (sans silences)') });
        if (!res.ok) return { kind: 'error', title: _T('Silences non coupés'), detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        lastCuts.push({ ranges: r.ranges, name: res.name });
        last = null;
        return {
          kind: res.warnings && res.warnings.length ? 'warn' : 'ok',
          title: app.plural(res.ranges, _T('silence coupé'), _T('silences coupés')) + ' · ' + fmtSecs(res.seconds) + _T(' en moins'),
          detail: (res.copy ? _T('Dans « ') + res.name + _T(' » : ta séquence d\'origine est intacte.') : _T('Ctrl+Z (Cmd+Z) dans Premiere pour revenir en arrière.')) + (res.warnings && res.warnings.length ? ' ' + res.warnings[0] : '')
        };
      }, true);
    }

    // ---------------------------------------------------------------- « euh » et répétitions

    /* « Euh » trouvés dans le son des plans choisis, et répétitions du .srt (s'il y en a un).
       → { fillers: [{ a, b }], repeats: [{ a, b, text, exact }] } en temps de séquence. */
    async function findFillers() {
      const x = st(), clips = await speechClips(), fillers = [];
      for (let i = 0; i < clips.length; i++) {
        app.status.progress(i, clips.length, _T('Écoute de ') + clips[i].name);
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
      return app.runTask(_T('« Euh » et répétitions'), async () => {
        app.status.phase(_T('Écoute du son'));
        const f = await findFillers();
        const exact = f.repeats.filter(r => r.exact), rough = f.repeats.filter(r => !r.exact);
        const cut = f.fillers.concat(exact.map(r => ({ a: r.a, b: r.b }))).sort((p, q) => p.a - q.a);
        if (!cut.length && !rough.length) return { kind: 'warn', title: _T('Aucun « euh » trouvé'), detail: _T('Essaie la sensibilité « Forte ». Les répétitions sont lues dans le .srt (onglet Parole > Sous-titres).') };
        const n = app.plural(f.fillers.length, _T('« euh »'), _T('« euh »')) + (f.repeats.length ? _T(' et ') + app.plural(f.repeats.length, _T('répétition')) : '');
        if (x.fillerMode === 'markers' || !cut.length) {
          const all = cut.concat(rough).sort((p, q) => p.a - q.a);
          const m = await Host.call('addMarkers', { times: all.map(r => r.a), name: 'RR FX · euh / répétition', color: 5 });
          if (!m.ok) return { kind: 'error', title: _T('Marqueurs non posés'), detail: m.error };
          return { kind: 'ok', title: n + _T(' marqué') + (all.length > 1 ? 's' : ''), detail: _T('Un marqueur au début de chacun : vérifie et coupe à ton rythme.') };
        }
        if (x.fillerMode !== 'copy' && app.versions) await app.versions.beforeCut(_T('avant euh'));
        app.status.phase(_T('Coupe et recollage'));
        const res = await Host.call('cutSilences', { ranges: cut, copy: x.fillerMode === 'copy', suffix: _T(' (sans euh)') });
        if (!res.ok) return { kind: 'error', title: _T('Rien n\'a été coupé'), detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        lastCuts.push({ ranges: cut, name: res.name });
        rough.forEach(r => app.log(_T('Répétition à vérifier (temps estimé) : « ') + r.text + _T(' »'), 'warn'));
        return {
          kind: rough.length || (res.warnings && res.warnings.length) ? 'warn' : 'ok',
          title: n + ' : ' + fmtSecs(res.seconds) + _T(' en moins'),
          detail: (res.copy ? _T('Dans « ') + res.name + _T(' ».') : _T('Ctrl+Z dans Premiere pour revenir.')) + (rough.length ? ' ' + app.plural(rough.length, _T('répétition')) + _T(' à vérifier (sous-titres non découpés mot par mot) : voir le journal.') : '')
        };
      }, true);
    }

    // ---------------------------------------------------------------- son de la voix

    // Chaque plan parlé amené à la même sonie (et débruité en option).
    function levelVoice() {
      const x = st();
      return app.runTask(_T('Son de la voix'), async () => {
        const clips = await speechClips(), todo = [], before = [];
        // Un même enregistrement (souvent coupé en morceaux par la coupe des silences) est mesuré
        // en entier et reçoit un seul gain : pas de volume qui saute d'un morceau à l'autre.
        const groups = new Map();
        clips.forEach(c => { const k = c.path || c.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
        let n = 0;
        for (const list of groups.values()) {
          app.status.progress(n++, groups.size, _T('Mesure de ') + list[0].name);
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
          if (g.limited) app.log(list[0].name + _T(' : gain limité à ') + g.gain + _T(' dB (crêtes déjà hautes)'), 'warn');
          list.forEach(c => (c.audio || []).forEach(t => todo.push({ track: t.track, start: t.start, gain: g.gain })));
        }
        if (!todo.length) return { kind: 'warn', title: _T('Aucun son à régler'), detail: _T('Sélectionne des plans avec leur son (image et son liés, ou le son seul).') };
        const r = await Host.call('voiceLevel', { clips: todo, denoise: x.denoise ? DENOISE : null });
        if (!r.ok) return { kind: 'error', title: _T('Niveau non réglé'), detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        if (r.created.length) app.pushHistory({ date: Date.now(), label: _T('Son de la voix'), entries: r.created });
        const lo = Math.round(Math.min(...before)), hi = Math.round(Math.max(...before));
        return { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', title: app.plural(r.done, _T('son réglé'), _T('sons réglés')) + _T(' à ') + x.voiceTarget + ' LUFS', detail: _T('Avant : ') + (lo === hi ? lo : _T('de ') + lo + _T(' à ') + hi) + ' LUFS.' + (r.cleaned ? _T(' Débruitage ajouté (réglable dans Options d\'effet).') : '') + _T(' ↶ Annuler remet le volume d\'avant.') };
      });
    }

    // ---------------------------------------------------------------- musique sous la voix

    function duckMusic() {
      const x = st();
      return app.runTask(_T('Musique sous la voix'), async () => {
        app.status.phase(_T('Écoute de la voix'));
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
        if (!m.ok) return { kind: 'error', title: _T('Pas de musique'), detail: m.error || _T('Pose ta musique sur une piste audio.') };
        const keys = V.duckKeys(speech, { depth: x.duckDepth, from: m.start, to: m.end });
        if (!keys.length) return { kind: 'warn', title: _T('Rien à baisser'), detail: _T('La voix ne passe pas pendant la musique.') };
        const res = await Host.call('duckMusic', { track: m.track, start: m.start, keys });
        if (!res.ok) return { kind: 'error', title: _T('Volume non réglé'), detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        app.pushHistory({ date: Date.now(), label: _T('Musique sous la voix'), entries: res.created });
        return { kind: 'ok', title: _T('Musique baissée de ') + x.duckDepth + _T(' dB sous la voix'), detail: app.plural(speech.length, _T('passage parlé'), _T('passages parlés')) + _T(' sur « ') + m.name + _T(' ». ↶ Annuler remet le volume d\'avant.') };
      });
    }

    // ---------------------------------------------------------------- chapitres YouTube

    let chap = null;
    function makeChapters(refresh) {
      const x = st();
      return app.runTask(_T('Chapitres YouTube'), async () => {
        let res;
        if (x.chapSrc === 'markers') {
          const m = await Host.call('markerList', {});
          if (!m.ok) return { kind: 'error', title: _T('Marqueurs illisibles'), detail: m.error };
          // Les marqueurs posés par RR FX (temps forts, silences) ne sont pas des chapitres.
          const mk = m.markers.filter(q => !/^RR FX · /.test(q.name || '') || /chapitre/i.test(q.name || ''));
          if (!mk.length) return { kind: 'warn', title: _T('Aucun marqueur'), detail: _T('Pose un marqueur nommé au début de chaque partie (touche M, puis double-clic pour le nommer), ou choisis « Sous-titres ».') };
          res = Sp.chapters({ markers: mk });
        } else {
          const cues = Sp.parseSubtitles(x.srt);
          if (!cues.length) return { kind: 'warn', title: _T('Pas de sous-titres'), detail: _T('Importe ton .srt ci-dessus, ou choisis « Marqueurs ».') };
          res = Sp.chapters({ cues: cutAware(Sp.offset(cues, await startTime(x.capFrom))) });
        }
        chap = res;
        refresh();
        return { kind: res.ok ? 'ok' : 'warn', title: app.plural(res.list.length, _T('chapitre')), detail: res.ok ? _T('Copie-les dans la description YouTube.') : res.why };
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
        if (!m.range) throw new Error(_T('Sélectionne le plan de départ dans la timeline (ou choisis « Début de la séquence »).'));
        return m.range.a;
      }
      return 0;
    }

    /* Bruitages des sous-titres : [{ id, times }]. auto : pop sur les mots clés, ding sur les
       emojis. Chaque son est calé sur l'instant estimé du mot clé. */
    function accentPlan(items) {
      const x = st(), out = new Map();
      items.forEach(it => {
        if (x.popSound === 'keys' && !it.hasKey && !it.key) return;
        const id = x.popId === 'auto' ? (it.emoji ? 'ding' : 'pop') : x.popId;
        const snd = root.RRFXSons.byId(id);
        if (!snd) return;
        const at = Math.max(0, (it.hasKey ? it.keyAt : it.start) - snd.peak);
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(Math.round(at * 1000) / 1000);
      });
      return Array.from(out, ([id, times]) => ({ id, times }));
    }

    /* opts.remap : recaler sur la dernière coupe des silences (le .srt vient d'avant la coupe).
       opts.range { a, b } : seulement ce passage, posé à partir de 0 (extraits pour les réseaux). */
    function captions(opts) {
      const x = st(), range = opts && opts.range, remap = range ? false : opts && 'remap' in opts ? opts.remap : x.remap !== false;
      return app.runTask(_T('Sous-titres'), async () => {
        let cues = Sp.parseSubtitles(x.srt);
        if (range) cues = cues.filter(c => c.end > range.a + 0.05 && c.start < range.b - 0.05).map(c => Object.assign({}, c, { start: Math.max(0, c.start - range.a), end: Math.min(range.b, c.end) - range.a }));
        if (!cues.length) return { kind: 'error', title: _T('Pas de sous-titres'), detail: _T('Importe ou colle un fichier .srt / .vtt (Premiere : Texte > Sous-titres > Exporter en fichier SRT).') };
        if (!app.services.mogrt()) return { kind: 'error', title: _T('Choisis un modèle de texte'), detail: _T('Onglet Textes > Modèle de texte.') };
        const t0 = range ? 0 : await startTime(x.capFrom);
        // Mots clés repérés (couleur, emoji) pendant le découpage.
        const marked = x.keys !== 'none' || x.emoji;
        let items = Sp.offset(marked ? Sp.highlight(cues, x.words, { emoji: x.emoji, list: String(x.keyList || '').split(/[,;\n]+/) }) : Sp.splitCues(cues, x.words), t0);
        if (remap && lastCuts.length) { items = cutAware(items); app.log(_T('Sous-titres recalés sur ') + app.plural(lastCuts.length, _T('coupe')) + ' (' + lastCuts[lastCuts.length - 1].name + ')', 'info'); }
        app.status.phase(_T('Pose des sous-titres'));
        const keyFx = x.keys === 'color' ? Core.toWire(Core.compileEffect({ params: [], build: () => [{ type: 'tint', props: { black: [0, 0, 0], white: rgb(x.keyColor), amount: 100 } }] }, {}, 'post', 1, app.fps(), app.registry())) : null;
        const r = await app.services.placeTexts(items, { anim: x.capAnim, label: _T('Sous-titres'), pos: [0.5, 0.78], keyFx, style: x.capStyle });
        if (r.error) return { kind: 'error', title: _T('Sous-titres non posés'), detail: r.error };
        // Bruitages sur les mots clés (et emojis), ou sur chaque sous-titre, calés sur le mot.
        let pops = 0;
        if (x.popSound !== 'none' && r.created.length && !app.S.cancel) {
          const done = [];
          for (const part of accentPlan(items)) {
            const s = root.RRFXSons.byId(part.id), snd = await Host.call('placeAsset', { kind: 'audio', path: app.services.ensureSound(part.id), name: s.name, times: part.times, gain: x.popVol });
            if (snd.ok) { pops += snd.created.length; done.push(...snd.created); } else app.log(_T('Bruitages : ') + snd.error, 'warn');
          }
          if (done.length) app.pushHistory({ date: Date.now(), label: _T('Bruitages des sous-titres'), entries: done });
        }
        const keyCount = items.filter(it => it.key).length;
        return { kind: r.warnings.length ? 'warn' : 'ok', title: app.plural(r.created.length, _T('sous-titre posé'), _T('sous-titres posés')) + (r.track !== null ? _T(' sur V') + (r.track + 1) : ''),
          detail: (marked ? app.plural(keyCount, _T('mot clé mis en avant'), _T('mots clés mis en avant')) + (pops ? ', ' + app.plural(pops, _T('bruitage')) : '') + '. ' : (pops ? app.plural(pops, _T('bruitage')) + '. ' : '')) + _T('Animation « ') + r.anim.name + _T(' ». Police : modifie le modèle dans Objets graphiques essentiels.') };
      }, true);
    }

    const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, 'ffd21e']; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

    function importSrt(refresh) {
      const files = Store.pickFiles(_T('Choisir des sous-titres (.srt, .vtt)'), ['srt', 'vtt']);
      if (files === null) return app.status.finish('warn', _T('Disponible dans Premiere'), _T('Le choix de fichier passe par Premiere. Ici, colle le texte du .srt.'));
      if (!files.length) return null;
      try { st().srt = Store.fs.readFileSync(files[0], 'utf8').replace(/^﻿/, ''); } catch (e) { return app.status.finish('error', _T('Fichier illisible'), app.errorMessage(e)); }
      app.persist();
      refresh();
      return app.status.finish('ok', app.plural(Sp.parseSubtitles(st().srt).length, _T('sous-titre lu'), _T('sous-titres lus')), Store.path.basename(files[0]));
    }

    // ---------------------------------------------------------------- bandeau

    const LOWER_POS = { left: [0.3, 0.84], center: [0.5, 0.84], top: [0.3, 0.14] };

    function lowerThird() {
      const x = st();
      return app.runTask(_T('Bandeau'), async () => {
        const text = [x.name, x.role].map(v => String(v || '').trim()).filter(Boolean).join('\r');
        if (!text) return { kind: 'error', title: _T('Écris un nom'), detail: _T('Le nom (et la fonction) de la personne qui parle.') };
        if (!app.services.mogrt()) return { kind: 'error', title: _T('Choisis un modèle de texte'), detail: _T('Onglet Textes > Modèle de texte.') };
        const t0 = await startTime('playhead');
        const r = await app.services.placeTexts([{ start: t0, end: t0 + x.lowerDur, text }], { anim: x.lowerAnim, label: _T('Bandeau'), pos: LOWER_POS[x.lowerPos] || LOWER_POS.left, style: x.lowerStyle });
        if (r.error) return { kind: 'error', title: _T('Bandeau non posé'), detail: r.error };
        return { kind: r.warnings.length ? 'warn' : 'ok', title: _T('Bandeau posé · ') + String(x.name || x.role).trim(), detail: x.lowerDur + _T(' s à la tête de lecture') + (r.track !== null ? _T(', sur V') + (r.track + 1) : '') + _T('. Déplace-le comme un clip.') };
      });
    }

    // ---------------------------------------------------------------- interface

    let bar = null;
    function draw() {
      if (!bar || !bar.isConnected) return;
      bar.innerHTML = '';
      if (!last) { bar.appendChild(h('div', { class: 'note' }, _T('Sélectionne tes plans, puis « Analyser » : les silences s\'affichent ici avant de couper.'))); return; }
      const len = Math.max(1e-6, last.b - last.a), sec = Sp.total(last.ranges);
      const track = h('div', { class: 'sp-track' }, last.ranges.map(r => h('span', { class: 'sp-gap', style: { left: ((r.a - last.a) / len * 100).toFixed(2) + '%', width: Math.max(0.4, (r.b - r.a) / len * 100).toFixed(2) + '%' } })));
      bar.appendChild(track);
      bar.appendChild(h('div', { class: 'note' }, last.ranges.length
        ? app.plural(last.ranges.length, 'silence', 'silences') + ' · ' + fmtSecs(sec) + _T(' sur ') + fmtSecs(len) + ' (' + Math.round(sec / len * 100) + _T(' %). En rouge : ce qui sera retiré.')
        : _T('Aucun silence avec ces réglages.')));
    }

    function render(view) {
      const x = st();
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'xp-hero' },
        h('div', { class: 'xp-hero-title' }, _T('Vidéos qui parlent')),
        h('div', { class: 'xp-hero-text' }, _T('YouTube, vlogs, interviews, podcasts, vidéos d\'entreprise : silences et « euh » coupés, zoom visage, sous-titres avec mots clés, son de la voix, musique sous la voix, chapitres.'))));

      // Sommaire collant : un clic amène à la section (et la déplie).
      const nav = h('div', { class: 'sec-nav', role: 'navigation', 'aria-label': _T('Sections de l\'onglet Parole') });
      NAV.concat(extras().map(e => [e.id, e.nav])).forEach(([k, label]) => {
        const b = h('button', { class: 'action' + (x.lastTool === k ? ' selected' : ''), 'data-target': k }, label);
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
      const analyzeBtn = h('button', { class: 'action' }, _T('Analyser'));
      analyzeBtn.addEventListener('click', () => app.runTask(_T('Analyse des silences'), async () => {
        const r = await analyze();
        draw();
        return { kind: r.ranges.length ? 'ok' : 'warn', title: r.ranges.length ? app.plural(r.ranges.length, _T('silence trouvé'), _T('silences trouvés')) + ' · ' + fmtSecs(Sp.total(r.ranges)) : _T('Aucun silence trouvé'), detail: r.ranges.length ? _T('Rien n\'est coupé tant que tu ne cliques pas sur « Couper les silences ».') : _T('Essaie la sensibilité « Forte ».') };
      }));
      const cutBtn = h('button', { class: 'action go' }, _T('Couper les silences'));
      cutBtn.addEventListener('click', use('silences', () => cutSilences()));
      bar = h('div', { class: 'sp-bar' });
      const reset = () => { last = null; draw(); app.persist(); };
      view.appendChild(sec('silences', _T('Couper les silences'), [
        h('div', { class: 'note' }, _T('Sélectionne dans la timeline les plans où l\'on parle (image et son, ou le son seul). RR FX écoute le son, trouve les blancs et les retire en recollant la suite.')),
        row(_T('Sensibilité'), actionGroup([{ v: 'soft', label: _T('Douce'), title: _T('Seulement les vrais blancs') }, { v: 'normal', label: _T('Normale') }, { v: 'strong', label: _T('Forte'), title: _T('Aussi les respirations et les « euh » faibles') }], x.level, v => { x.level = v; reset(); })),
        row(_T('Silence min.'), hotText({ value: x.minSilence, min: 0.2, max: 3, step: 0.05, unit: 's', onChange: v => { x.minSilence = v; reset(); } }), { title: _T('Les pauses plus courtes sont gardées') }),
        row(_T('Marge gardée'), hotText({ value: x.pad, min: 0, max: 0.5, step: 0.01, unit: 's', onChange: v => { x.pad = v; reset(); } }), { title: _T('Laissée de chaque côté de la voix, pour ne pas couper les mots') }),
        row(_T('Résultat'), actionGroup([{ v: 'copy', label: _T('Sur une copie'), title: _T('Une copie « (sans silences) » : ta séquence reste intacte') }, { v: 'cut', label: _T('Directement'), title: _T('Dans la séquence ouverte (Ctrl+Z pour revenir)') }, { v: 'markers', label: _T('Marqueurs'), title: _T('Un marqueur sur chaque silence, rien n\'est coupé') }], x.mode, v => { x.mode = v; app.persist(); })),
        bar,
        h('div', { class: 'row-buttons' }, analyzeBtn, cutBtn),
        h('div', { class: 'note' }, _T('À faire avant d\'ajouter musique, plans de coupe et titres : les autres pistes ne sont pas décalées.'))
      ]));
      draw();

      // « Euh » et répétitions
      const fillBtn = h('button', { class: 'action go' }, _T('Couper les « euh »'));
      fillBtn.addEventListener('click', use('euh', cutFillers));
      view.appendChild(sec('euh', _T('« Euh » et répétitions'), [
        h('div', { class: 'note' }, _T('RR FX écoute les plans choisis et repère les « euh », « hum » et voyelles tenues entre deux mots. Avec un .srt (section Sous-titres), il trouve aussi les répétitions (« on va, on va ») et les faux départs.')),
        row(_T('Sensibilité'), actionGroup([{ v: 'soft', label: _T('Douce') }, { v: 'normal', label: _T('Normale') }, { v: 'strong', label: _T('Forte') }], x.fillerLevel, v => { x.fillerLevel = v; app.persist(); })),
        row(_T('Résultat'), actionGroup([{ v: 'copy', label: _T('Sur une copie'), title: _T('Une copie « (sans euh) » : ta séquence reste intacte') }, { v: 'cut', label: _T('Directement') }, { v: 'markers', label: _T('Marqueurs'), title: _T('Conseillé pour un premier essai : un marqueur sur chaque « euh »') }], x.fillerMode, v => { x.fillerMode = v; app.persist(); })),
        h('div', { class: 'note' }, _T('Les répétitions dont le temps n\'est qu\'estimé (sous-titres de plusieurs mots) sont seulement listées dans le journal, ou marquées.')),
        h('div', { class: 'row-buttons' }, fillBtn)
      ]));

      // Zoom visage
      const punch = h('button', { class: 'action go' }, _T('Zoomer sur le visage'));
      punch.addEventListener('click', use('visage', punchIn));
      // Le même zoom, sur une seule coupe ou tout un plan : l'effet « Zoom visage » de l'onglet Effets.
      const faceFx = h('button', { class: 'action quiet', title: _T('Effets › Mouvements : sur la coupe, les marqueurs, les temps forts ou tout un plan') }, _T('Sur une coupe ou un plan : Effets ›'));
      faceFx.addEventListener('click', () => app.services.openEffect && app.services.openEffect('b:face-zoom'));
      view.appendChild(sec('visage', _T('Zoom visage'), [
        h('div', { class: 'note' }, _T('RR FX trouve le visage dans chaque plan et zoome sur les yeux en les suivant : ils restent à leur place à l\'écran pendant que le cadre se resserre. Après la coupe des silences, un plan sur deux : chaque jump cut devient un changement de cadre.')),
        row('Zoom', hotText({ value: x.faceAmount, min: 5, max: 60, step: 1, unit: '%', onChange: v => { x.faceAmount = v; app.persist(); } })),
        row(_T('Plans'), actionGroup([{ v: true, label: _T('Un sur deux') }, { v: false, label: _T('Tous') }], x.faceAlt, v => { x.faceAlt = v; app.persist(); }), { title: _T('Sur tous les plans de la séquence') }),
        row(_T('Yeux'), actionGroup([{ v: 'keep', label: _T('À leur place') }, { v: 'center', label: _T('Recentrés') }], x.faceFrame, v => { x.faceFrame = v; app.persist(); })),
        h('div', { class: 'field' }, app.UI.checkbox(_T('Suivre le visage (sinon : zoom fixe vers le haut du cadre)'), x.faceTrack, v => { x.faceTrack = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, punch, faceFx)
      ]));

      // Sous-titres
      const ta = h('textarea', { class: 'code lyrics', rows: 5, spellcheck: 'false', placeholder: _T('1\n00:00:01,000 --> 00:00:03,200\nBonjour à tous…') }, x.srt);
      const count = h('div', { class: 'note' });
      const updateCount = () => {
        const cues = Sp.parseSubtitles(x.srt), n = Sp.splitCues(cues, x.words).length;
        count.textContent = cues.length ? app.plural(cues.length, _T('sous-titre lu'), _T('sous-titres lus')) + (n !== cues.length ? ' → ' + n + _T(' textes à l\'écran') : '') + '.' : _T('Aucun sous-titre lu.');
      };
      ta.addEventListener('input', () => { x.srt = ta.value; updateCount(); app.persist(); });
      updateCount();
      const imp = h('button', { class: 'action' }, _T('Importer un .srt…'));
      imp.addEventListener('click', () => importSrt(() => app.switchTab('speech')));
      const capBtn = h('button', { class: 'action go' }, _T('Poser les sous-titres'));
      // Ou une piste de sous-titres de Premiere (styles et retouches dans le panneau Texte).
      const capNative = h('button', { class: 'action quiet', title: _T('Une piste de sous-titres de Premiere, modifiable dans son panneau Texte') }, _T('En sous-titres de Premiere'));
      capNative.addEventListener('click', () => app.actions.nativeCaptions && app.actions.nativeCaptions());
      capBtn.addEventListener('click', use('soustitres', () => captions()));
      const anims = app.services.titleAnimOptions ? app.services.titleAnimOptions() : Lib.TITLE_ANIMS.map(a => ({ v: a.id, label: a.name }));
      const styles = app.textStyles ? app.textStyles.options() : [{ v: '', label: _T('Celui du modèle .mogrt') }];
      const model = app.services.mogrtName ? app.services.mogrtName() : '';
      view.appendChild(sec('soustitres', _T('Sous-titres'), [
        h('div', { class: 'note' }, _T('Un fichier .srt ou .vtt : Premiere le crée (Texte > Transcription, puis Sous-titres > Exporter en fichier SRT), comme la plupart des outils de transcription.')),
        h('div', { class: 'row-buttons' }, imp),
        ta, count,
        row(_T('À l\'écran'), actionGroup([{ v: 0, label: _T('Phrase entière') }, { v: 3, label: _T('3 mots') }, { v: 1, label: _T('Mot par mot'), title: _T('Le style TikTok / Reels') }], x.words, v => { x.words = v; updateCount(); app.persist(); })),
        row('Animation', picker(anims, x.capAnim, v => { x.capAnim = v; app.persist(); })),
        row('Style', picker(styles, x.capStyle, v => { x.capStyle = v; app.persist(); }), { title: _T('Tes styles se créent dans l\'onglet Textes > Style du texte') }),
        row(_T('Mots clés'), actionGroup([{ v: 'color', label: _T('En couleur') }, { v: 'none', label: _T('Non') }], x.keys, v => { x.keys = v; app.persist(); app.switchTab('speech'); }), { title: _T('Chiffres, mots forts, mots en MAJUSCULES ou suivis de « ! », et ta liste') }),
        x.keys === 'color' ? row(_T('Couleur'), app.services.colorPick ? app.services.colorPick(x.keyColor, v => { x.keyColor = v || '#ffd21e'; app.persist(); }) : swatches()) : null,
        row(_T('Tes mots'), keyListField(), { title: _T('Toujours mis en avant (séparés par des virgules)') }),
        h('div', { class: 'field' }, app.UI.checkbox(_T('Emoji après les mots clés (💰 🔥 💡…)'), x.emoji, v => { x.emoji = v; app.persist(); })),
        row(_T('Bruitage'), actionGroup([{ v: 'none', label: _T('Aucun') }, { v: 'keys', label: _T('Mots clés') }, { v: 'all', label: _T('Chaque texte') }], x.popSound, v => { x.popSound = v; app.persist(); })),
        row(_T('Son'), picker([{ v: 'auto', label: _T('Auto (pop, ding sur les emojis)') }, { v: 'pop', label: 'Pop' }, { v: 'ding', label: 'Ding' }, { v: 'clic', label: _T('Clic') }, { v: 'swish', label: _T('Swish court') }, { v: 'swoosh', label: 'Swoosh' }], x.popId, v => { x.popId = v; app.persist(); }), { title: _T('Calé sur le mot clé, pas seulement sur le début du sous-titre') }),
        row('Volume', hotText({ value: x.popVol, min: -24, max: 6, step: 1, unit: 'dB', onChange: v => { x.popVol = v; app.persist(); } })),
        row(_T('Départ du .srt'), picker([{ v: 'start', label: _T('Début de la séquence') }, { v: 'playhead', label: _T('Tête de lecture') }, { v: 'selection', label: _T('Début des clips sélectionnés') }], x.capFrom, v => { x.capFrom = v; app.persist(); })),
        lastCuts.length ? h('div', { class: 'field' }, app.UI.checkbox(_T('Recaler sur les coupes (silences, euh) : .srt fait avant'), x.remap !== false, v => { x.remap = v; app.persist(); })) : null,
        h('div', { class: 'note' }, _T('Modèle de texte : ') + (model || 'aucun') + _T(' (onglet Textes).')),
        h('div', { class: 'row-buttons' }, capBtn, capNative)
      ]));

      // Bandeau
      const field = (key, ph) => {
        const inp = h('input', { class: 'textfield', value: x[key], placeholder: ph });
        inp.addEventListener('input', () => { x[key] = inp.value; app.persist(); });
        return inp;
      };
      const lowBtn = h('button', { class: 'action go' }, _T('Poser le bandeau'));
      lowBtn.addEventListener('click', use('bandeau', lowerThird));
      view.appendChild(sec('bandeau', _T('Bandeau nom et fonction'), [
        h('div', { class: 'note' }, _T('Le nom de la personne qui parle, posé à la tête de lecture (interviews, témoignages, conférences).')),
        row(_T('Nom'), field('name', 'Camille Martin')),
        row(_T('Fonction'), field('role', _T('Directrice marketing'))),
        row(_T('Durée'), hotText({ value: x.lowerDur, min: 1, max: 30, step: 0.5, unit: 's', onChange: v => { x.lowerDur = v; app.persist(); } })),
        row(_T('Place'), actionGroup([{ v: 'left', label: _T('↙ Bas') }, { v: 'center', label: _T('↓ Centre') }, { v: 'top', label: _T('↖ Haut') }], x.lowerPos, v => { x.lowerPos = v; app.persist(); })),
        row('Animation', picker(anims, x.lowerAnim, v => { x.lowerAnim = v; app.persist(); })),
        row('Style', picker(styles, x.lowerStyle, v => { x.lowerStyle = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, lowBtn)
      ]));

      // Son de la voix
      const voiceBtn = h('button', { class: 'action go' }, _T('Égaliser la voix'));
      voiceBtn.addEventListener('click', use('voix', levelVoice));
      view.appendChild(sec('voix', _T('Son de la voix'), [
        h('div', { class: 'note' }, _T('Chaque plan parlé est mesuré (sonie en LUFS) et amené au même niveau : plus de plan trop faible ou trop fort. Les crêtes restent sous -1 dB.')),
        row(_T('Niveau (LUFS)'), actionGroup([{ v: -14, label: '-14 · Web', title: 'YouTube, Instagram, TikTok' }, { v: -16, label: '-16 · Podcast' }, { v: -23, label: '-23 · TV' }], x.voiceTarget, v => { x.voiceTarget = v; app.persist(); })),
        h('div', { class: 'field' }, app.UI.checkbox(_T('Réduire le bruit de fond (effet DeNoise de Premiere)'), x.denoise, v => { x.denoise = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, voiceBtn)
      ]));

      // Musique sous la voix
      const duckBtn = h('button', { class: 'action go' }, _T('Baisser la musique sous la voix'));
      duckBtn.addEventListener('click', use('musique', duckMusic));
      view.appendChild(sec('musique', _T('Musique sous la voix'), [
        h('div', { class: 'note' }, _T('Sélectionne les plans où l\'on parle : la musique de la séquence baisse doucement pendant la voix et remonte dans les pauses (images clés de volume, modifiables).')),
        row(_T('Baisse'), hotText({ value: x.duckDepth, min: 3, max: 30, step: 1, unit: 'dB', onChange: v => { x.duckDepth = v; app.persist(); } })),
        h('div', { class: 'row-buttons' }, duckBtn)
      ]));

      // Chapitres YouTube
      const chapBox = h('div');
      const drawChap = () => {
        chapBox.innerHTML = '';
        if (!chap) return;
        const out = h('textarea', { class: 'code', rows: Math.min(12, chap.list.length + 1), readonly: true }, chap.text);
        const copy = h('button', { class: 'action' }, _T('Copier'));
        copy.addEventListener('click', () => (navigator.clipboard ? navigator.clipboard.writeText(chap.text) : Promise.reject(new Error(_T('presse-papiers indisponible'))))
          .then(() => app.status.finish('ok', _T('Chapitres copiés'), _T('Colle-les dans la description de ta vidéo YouTube.')), e => app.status.finish('warn', _T('Copie impossible'), app.errorMessage(e))));
        const mark = h('button', { class: 'action' }, _T('Poser les marqueurs'));
        mark.addEventListener('click', () => app.runTask(_T('Marqueurs de chapitre'), async () => {
          for (const c of chap.list) {
            const m = await Host.call('addMarkers', { times: [c.t], name: 'RR FX · Chapitre · ' + c.title, color: 4 });
            if (!m.ok) return { kind: 'error', title: _T('Marqueurs non posés'), detail: m.error };
          }
          return { kind: 'ok', title: app.plural(chap.list.length, _T('marqueur de chapitre'), _T('marqueurs de chapitre')), detail: _T('Renomme-les dans Premiere si besoin : RR FX les relit.') };
        }));
        chapBox.appendChild(out);
        if (chap.why) chapBox.appendChild(h('div', { class: 'note' }, chap.why));
        chapBox.appendChild(h('div', { class: 'row-buttons' }, copy, x.chapSrc === 'srt' ? mark : null));
      };
      const chapBtn = h('button', { class: 'action go' }, _T('Créer les chapitres'));
      chapBtn.addEventListener('click', use('chapitres', () => makeChapters(drawChap)));
      view.appendChild(sec('chapitres', _T('Chapitres YouTube'), [
        h('div', { class: 'note' }, _T('La liste « 00:00 Titre » à coller dans la description : depuis tes marqueurs nommés, ou depuis les grands blancs du .srt (le début de la phrase suivante sert de titre).')),
        row(_T('Depuis'), actionGroup([{ v: 'markers', label: _T('Les marqueurs') }, { v: 'srt', label: _T('Les sous-titres') }], x.chapSrc, v => { x.chapSrc = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, chapBtn),
        chapBox
      ]));
      drawChap();
      app.renderExtras('speech', view, use);
    }

    // Section repérée par une clé (sommaire, dernier outil utilisé).
    const sec = (key, title, body) => { const el = section(title, body); el.dataset.sec = key; return el; };
    // Le bouton bleu du haut reprend le dernier outil utilisé de l'onglet.
    const use = (key, fn) => () => { st().lastTool = key; app.persist(); app.renderCTA(); return fn(); };

    function swatches() {
      const x = st(), box = h('div', { class: 'key-colors' });
      KEY_COLORS.forEach(c => {
        const b = h('button', { class: 'key-color' + (x.keyColor === c ? ' on' : ''), style: { background: c }, title: c, 'aria-label': _T('Couleur ') + c });
        b.addEventListener('click', () => { x.keyColor = c; app.persist(); box.querySelectorAll('.key-color').forEach(q => q.classList.toggle('on', q === b)); });
        box.appendChild(b);
      });
      return box;
    }
    function keyListField() {
      const x = st(), inp = h('input', { class: 'textfield', value: x.keyList, placeholder: _T('formation, gratuit, Robin') });
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
    app.tabs.speech = {
      render, leave: () => {},
      cta: () => { const e = extras().find(q => q.id === st().lastTool && q.tool), t = e ? e.tool : TOOLS[st().lastTool] || TOOLS.silences; return { label: t[0], run: t[1], enabled: true }; }
    };
    // Pour les outils ajoutés à l'onglet.
    // Les sous-titres à leur place dans la séquence (départ choisi, recalés sur les coupes faites).
    const timedCues = async () => cutAware(Sp.offset(Sp.parseSubtitles(st().srt), await startTime(st().capFrom)));
    app.speech = { clips: speechClips, readClip, settings: st, cues: () => Sp.parseSubtitles(st().srt), timedCues, lastCuts: () => lastCuts, captions, analyzeSilences: analyze, startTime };
  });
})(typeof self !== 'undefined' ? self : this);
