/* RR FX : onglet Parole, pour tout ce qui parle (YouTube, vlogs, interviews, podcasts filmés,
   vidéos d'entreprise, conférences) :
   - Couper les silences : RR FX écoute le son des plans choisis, trouve les blancs et les
     retire en recollant la suite (sur une copie de la séquence par défaut).
   - Zoom visage : un plan sur deux (ou tous) resserré sur les yeux, qui sont suivis : la coupe
     devient un changement de cadre et le regard ne bouge pas.
   - Sous-titres : un .srt / .vtt posé en textes animés, en phrases ou en mots courts.
   - Bandeau nom et fonction (lower third). */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Sp = root.RRFXSpeech, { Lib, Store, Host } = app;
    const { h, hotText, actionGroup, picker, row, section } = app.UI;

    const DEFAULTS = {
      level: 'normal', minSilence: 0.5, pad: 0.12, mode: 'copy', remap: true,
      faceAmount: 20, faceAlt: true, faceTrack: true, faceFrame: 'keep',
      srt: '', words: 0, capAnim: 'pop', capFrom: 'start',
      name: '', role: '', lowerDur: 5, lowerPos: 'left', lowerAnim: 'slide-up'
    };
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
    let lastCut = null; // dernière coupe { ranges, name } : pour recaler les sous-titres

    async function analyze() {
      const x = st();
      const info = await Host.call('speechInfo', {});
      if (!info.ok) throw new Error(info.error);
      if (!info.clips.length) throw new Error('Sélectionne dans la timeline les plans où l\'on parle (image et son, ou le son seul).');
      const per = [];
      let mute = 0;
      for (let i = 0; i < info.clips.length; i++) {
        const c = info.clips[i], dur = (c.end - c.start) * c.speed;
        app.status.progress(i, info.clips.length, 'Écoute de ' + c.name);
        let samples, sr, t0 = c.inPoint;
        if (app.S.demo) { sr = 16000; samples = Sp.demoSpeech(sr, dur); } else if (!c.path) { mute++; per.push({ start: c.start, end: c.end, silent: [] }); continue; } else {
          const a = await app.services.readAudio(c.path, c.inPoint, c.inPoint + dur);
          samples = a.samples; sr = a.sampleRate; t0 = a.start;
        }
        const d = Sp.detect(samples, sr, { level: x.level, minSilence: x.minSilence, pad: x.pad });
        const toSeq = t => c.start + (t0 + t - c.inPoint) / c.speed;
        per.push({ start: c.start, end: c.end, silent: d.ranges.map(r => ({ a: toSeq(r.a), b: toSeq(r.b) })) });
      }
      if (mute) app.log(app.plural(mute, 'plan sans fichier son lisible', 'plans sans fichier son lisible') + ' (séquence imbriquée ?) : gardés en entier.', 'warn');
      const ranges = Sp.combine(per);
      last = { ranges, a: Math.min(...per.map(p => p.start)), b: Math.max(...per.map(p => p.end)), clips: info.clips.length };
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
        lastCut = { ranges: r.ranges, name: res.name };
        last = null;
        return {
          kind: res.warnings && res.warnings.length ? 'warn' : 'ok',
          title: app.plural(res.ranges, 'silence coupé', 'silences coupés') + ' · ' + fmtSecs(res.seconds) + ' en moins',
          detail: (res.copy ? 'Dans « ' + res.name + ' » : ta séquence d\'origine est intacte.' : 'Ctrl+Z (Cmd+Z) dans Premiere pour revenir en arrière.') + (res.warnings && res.warnings.length ? ' ' + res.warnings[0] : '')
        };
      }, true);
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
        let items = Sp.offset(Sp.splitCues(cues, x.words), t0);
        if (remap && lastCut) { items = Sp.remap(items, lastCut.ranges); app.log('Sous-titres recalés sur la coupe des silences (' + lastCut.name + ')', 'info'); }
        app.status.phase('Pose des sous-titres');
        const r = await app.services.placeTexts(items, { anim: x.capAnim, label: 'Sous-titres', pos: [0.5, 0.78] });
        if (r.error) return { kind: 'error', title: 'Sous-titres non posés', detail: r.error };
        return { kind: r.warnings.length ? 'warn' : 'ok', title: app.plural(r.created.length, 'sous-titre posé', 'sous-titres posés') + (r.track !== null ? ' sur V' + (r.track + 1) : ''), detail: 'Animation « ' + r.anim.name + ' ». Police et couleur : modifie le modèle dans Objets graphiques essentiels.' };
      }, true);
    }

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
        const r = await app.services.placeTexts([{ start: t0, end: t0 + x.lowerDur, text }], { anim: x.lowerAnim, label: 'Bandeau', pos: LOWER_POS[x.lowerPos] || LOWER_POS.left });
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
        h('div', { class: 'xp-hero-text' }, 'YouTube, vlogs, interviews, podcasts, vidéos d\'entreprise : silences coupés, zooms sur les jump cuts, sous-titres et bandeaux en quelques clics.')));

      // Silences
      const analyzeBtn = h('button', { class: 'action' }, 'Analyser');
      analyzeBtn.addEventListener('click', () => app.runTask('Analyse des silences', async () => {
        const r = await analyze();
        draw();
        return { kind: r.ranges.length ? 'ok' : 'warn', title: r.ranges.length ? app.plural(r.ranges.length, 'silence trouvé', 'silences trouvés') + ' · ' + fmtSecs(Sp.total(r.ranges)) : 'Aucun silence trouvé', detail: r.ranges.length ? 'Rien n\'est coupé tant que tu ne cliques pas sur « Couper les silences ».' : 'Essaie la sensibilité « Forte ».' };
      }));
      const cutBtn = h('button', { class: 'action selected' }, 'Couper les silences');
      cutBtn.addEventListener('click', () => cutSilences());
      bar = h('div', { class: 'sp-bar' });
      const reset = () => { last = null; draw(); app.persist(); };
      view.appendChild(section('Couper les silences', [
        h('div', { class: 'note' }, 'Sélectionne dans la timeline les plans où l\'on parle (image et son, ou le son seul). RR FX écoute le son, trouve les blancs et les retire en recollant la suite.'),
        row('Sensibilité', actionGroup([{ v: 'soft', label: 'Douce', title: 'Seulement les vrais blancs' }, { v: 'normal', label: 'Normale' }, { v: 'strong', label: 'Forte', title: 'Aussi les respirations et les « euh » faibles' }], x.level, v => { x.level = v; reset(); })),
        row('Silence minimum', hotText({ value: x.minSilence, min: 0.2, max: 3, step: 0.05, unit: 's', onChange: v => { x.minSilence = v; reset(); } }), { title: 'Les pauses plus courtes sont gardées' }),
        row('Marge gardée', hotText({ value: x.pad, min: 0, max: 0.5, step: 0.01, unit: 's', onChange: v => { x.pad = v; reset(); } }), { title: 'Laissée de chaque côté de la voix, pour ne pas couper les mots' }),
        row('Résultat', actionGroup([{ v: 'copy', label: 'Sur une copie', title: 'Une copie « (sans silences) » : ta séquence reste intacte' }, { v: 'cut', label: 'Dans la séquence' }, { v: 'markers', label: 'Marquer seulement' }], x.mode, v => { x.mode = v; app.persist(); })),
        bar,
        h('div', { class: 'row-buttons' }, analyzeBtn, cutBtn),
        h('div', { class: 'note' }, 'À faire avant d\'ajouter musique, plans de coupe et titres : les autres pistes ne sont pas décalées.')
      ]));
      draw();

      // Zoom visage
      const punch = h('button', { class: 'action selected' }, 'Zoomer sur le visage');
      punch.addEventListener('click', punchIn);
      view.appendChild(section('Zoom visage', [
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
      const capBtn = h('button', { class: 'action selected' }, 'Poser les sous-titres');
      capBtn.addEventListener('click', captions);
      const anims = Lib.TITLE_ANIMS.map(a => ({ v: a.id, label: a.name }));
      const model = app.services.mogrtName ? app.services.mogrtName() : '';
      view.appendChild(section('Sous-titres', [
        h('div', { class: 'note' }, 'Un fichier .srt ou .vtt : Premiere le crée (Texte > Transcription, puis Sous-titres > Exporter en fichier SRT), comme la plupart des outils de transcription.'),
        h('div', { class: 'row-buttons' }, imp),
        ta, count,
        row('À l\'écran', actionGroup([{ v: 0, label: 'Phrase entière' }, { v: 3, label: '3 mots' }, { v: 1, label: 'Mot par mot', title: 'Le style TikTok / Reels' }], x.words, v => { x.words = v; updateCount(); app.persist(); })),
        row('Animation', picker(anims, x.capAnim, v => { x.capAnim = v; app.persist(); })),
        row('Départ du .srt', picker([{ v: 'start', label: 'Début de la séquence' }, { v: 'playhead', label: 'Tête de lecture' }, { v: 'selection', label: 'Début des clips sélectionnés' }], x.capFrom, v => { x.capFrom = v; app.persist(); })),
        lastCut ? h('div', { class: 'field' }, app.UI.checkbox('Recaler sur la coupe des silences (.srt fait avant la coupe)', x.remap !== false, v => { x.remap = v; app.persist(); })) : null,
        h('div', { class: 'note' }, 'Modèle de texte : ' + (model || 'aucun') + ' (onglet Textes).'),
        h('div', { class: 'row-buttons' }, capBtn)
      ]));

      // Bandeau
      const field = (key, ph) => {
        const inp = h('input', { class: 'textfield', value: x[key], placeholder: ph });
        inp.addEventListener('input', () => { x[key] = inp.value; app.persist(); });
        return inp;
      };
      const lowBtn = h('button', { class: 'action selected' }, 'Poser le bandeau');
      lowBtn.addEventListener('click', lowerThird);
      view.appendChild(section('Bandeau nom et fonction', [
        h('div', { class: 'note' }, 'Le nom de la personne qui parle, posé à la tête de lecture (interviews, témoignages, conférences).'),
        row('Nom', field('name', 'Camille Martin')),
        row('Fonction', field('role', 'Directrice marketing')),
        row('Durée', hotText({ value: x.lowerDur, min: 1, max: 30, step: 0.5, unit: 's', onChange: v => { x.lowerDur = v; app.persist(); } })),
        row('Place', actionGroup([{ v: 'left', label: 'Bas gauche' }, { v: 'center', label: 'Bas centre' }, { v: 'top', label: 'Haut gauche' }], x.lowerPos, v => { x.lowerPos = v; app.persist(); })),
        row('Animation', picker(anims, x.lowerAnim, v => { x.lowerAnim = v; app.persist(); })),
        h('div', { class: 'row-buttons' }, lowBtn)
      ]));
    }

    app.actions.cutSilences = cutSilences;
    app.actions.captions = captions;
    app.actions.lowerThird = lowerThird;
    app.actions.punchIn = punchIn;
    app.services.speechClips = async () => { const r = await Host.call('speechInfo', {}).catch(() => ({ ok: false })); return r.ok ? r.clips.length : 0; };
    app.services.hasCaptions = () => Sp.parseSubtitles(st().srt).length;
    app.services.hasLowerThird = () => !!String(st().name || '').trim();
    app.tabs.speech = { render, cta: () => ({ label: 'Couper les silences', run: () => cutSilences(), enabled: true }), leave: () => {} };
  });
})(typeof self !== 'undefined' ? self : this);
