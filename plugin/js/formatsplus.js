/* RR FX : outils de l'onglet Formats.
   - Extraits pour les réseaux : RR FX écoute une longue vidéo (podcast, interview, live), trouve
     ses meilleurs passages de 20 à 60 s et en fait des séquences prêtes (9:16, sous-titres).
   - Vérifier avant export : médias hors ligne, images noires, pistes coupées, volume poussé,
     textes hors zone sûre ; un clic sur un problème y amène la tête de lecture.
   - Sur plusieurs séquences : le même look, la même conversion LOG, la même vérification ou la
     même copie au format réseau, séquence par séquence.
   - Modèles de projet : une séquence prête par type de vidéo (format, calque de réglage, style
     Express, styles des textes), depuis tes rushs sélectionnés. Les tiens dans Mes effets. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Mo = root.RRFXMontage, Sp = root.RRFXSpeech, { Host } = app;
    const { h, hotText, picker, row, checkbox } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.formatsPlus || typeof s.formatsPlus !== 'object') s.formatsPlus = {};
      const d = { count: 3, min: 25, max: 50, exFormat: true, exCaptions: true, batch: 'applyLook', template: 'b:interview', picked: [], pfImage: true };
      Object.keys(d).forEach(k => { if (!(k in s.formatsPlus)) s.formatsPlus[k] = JSON.parse(JSON.stringify(d[k])); });
      return s.formatsPlus;
    };
    const mmss = t => { const m = Math.floor(t / 60); return m + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
    const seek = t => Host.call('setPlayhead', { t });

    // ---------------------------------------------------------------- extraits

    let found = [];
    async function analyzeLong() {
      const clips = await app.speech.clips(), speech = [], energy = [];
      let a0 = Infinity, b0 = 0;
      for (let i = 0; i < clips.length; i++) {
        if (app.S.cancel) break;
        const c = clips[i];
        app.status.progress(i, clips.length, _T('Écoute de ') + c.name);
        const a = await app.speech.readClip(c);
        if (!a) continue;
        a0 = Math.min(a0, c.start); b0 = Math.max(b0, c.end);
        const d = Sp.detect(a.samples, a.sr, { level: 'normal', minSilence: 0.6, pad: 0.05 });
        Mo.speechFromSilences(0, a.samples.length / a.sr, d.ranges).forEach(r => speech.push({ a: a.toSeq(r.a), b: a.toSeq(r.b) }));
        // Volume de la voix, 10 valeurs par seconde de séquence, ramené de 0 à 1.
        const env = Sp.envelope(a.samples, a.sr), lo = d.floor || -60, hi = d.voice || -10;
        for (let k = 0; k < env.length; k += 5) energy.push({ t: a.toSeq(k * 0.02), v: Math.max(0, Math.min(1, (env[k] - lo) / Math.max(6, hi - lo))) });
      }
      const rate = 10, n = Math.max(1, Math.ceil(b0 * rate)), values = new Float32Array(n);
      energy.forEach(e => { const i = Math.floor(e.t * rate); if (i >= 0 && i < n) values[i] = Math.max(values[i], e.v); });
      return { speech, energy: { rate, values }, from: a0, to: b0 };
    }

    function findExtracts(redraw) {
      const x = st();
      return app.runTask(_T('Recherche des meilleurs passages'), async () => {
        app.status.phase(_T('Écoute de la vidéo'));
        const an = await analyzeLong();
        const cues = app.speech.cues();
        found = Mo.extracts({ speech: an.speech, energy: an.energy, cues, count: x.count, min: x.min, max: x.max }).map((e, i) => Object.assign(e, { on: true, n: i + 1 }));
        if (redraw) redraw();
        if (!found.length) return { kind: 'warn', title: _T('Aucun passage trouvé'), detail: _T('Sélectionne les plans où l\'on parle (au moins ') + x.min + _T(' s de parole), ou baisse la durée minimum.') };
        return { kind: 'ok', title: app.plural(found.length, _T('extrait trouvé'), _T('extraits trouvés')), detail: (cues.length ? _T('Phrases du .srt, ') : _T('Sans .srt : coupes sur les blancs, ')) + _T('à vérifier avant de créer.') };
      }, true);
    }

    async function makeExtracts() {
      const x = st(), list = found.filter(e => e.on);
      if (app.S.busy) return;
      if (!list.length) return app.status.finish('warn', _T('Aucun extrait choisi'), _T('Lance d\'abord « Trouver les passages ».'));
      const ctx = await Host.call('getContext', {});
      if (!ctx.ok || !ctx.hasSequence) return app.status.finish('error', _T('Ouvre la séquence de la vidéo'), _T('Les extraits sont pris dans la séquence active.'));
      const source = ctx.seqId, base = ctx.name, made = [];
      for (const e of list) {
        if (app.S.cancel) break;
        await Host.call('openSequence', { id: source });
        const name = base + _T(' · Extrait ') + e.n + (e.title ? ' · ' + e.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 40) : '');
        const r = await app.runTask(_T('Extrait ') + e.n + ' (' + mmss(e.a) + ' → ' + mmss(e.b) + ')', async () => {
          const res = await Host.call('extractCopy', { a: e.a, b: e.b, name });
          if (!res.ok) return { kind: 'error', title: _T('Extrait non créé'), detail: res.error };
          (res.warnings || []).forEach(w => app.log(w, 'warn'));
          return { kind: 'ok', title: _T('« ') + res.name + _T(' » créée'), detail: Math.round(res.seconds) + ' s' };
        });
        if (!r || r.kind === 'error') continue;
        made.push(name);
        if (x.exCaptions && app.speech.cues().length && app.services.mogrt()) await app.speech.captions({ range: { a: e.a, b: e.b } });
        if (x.exFormat && app.formats) await app.runTask(_T('Extrait ') + e.n + ' · ' + app.formats.fmt().label, app.formats.copyNow);
      }
      await Host.call('openSequence', { id: source });
      app.status.finish(made.length ? 'ok' : 'error', made.length ? app.plural(made.length, _T('extrait créé'), _T('extraits créés')) : _T('Aucun extrait créé'), made.length ? _T('Dans le panneau Projet : ') + made.map(n => _T('« ') + n.split(' · ').slice(1, 2).join('') + _T(' »')).join(', ') + (x.exFormat ? _T(', avec leur copie ') + app.formats.fmt().label : '') + _T('. Ta séquence d\'origine est intacte.') : _T('Voir le journal.'));
    }

    app.extras.formats.push({
      id: 'extraits', title: _T('Extraits pour les réseaux'), nav: _T('Extraits'),
      render: () => {
        const x = st(), box = h('div'), list = h('div', { class: 'ex-list' });
        const redraw = () => {
          list.innerHTML = '';
          found.forEach(e => {
            const cb = checkbox(mmss(e.a) + ' → ' + mmss(e.b) + ' · ' + Math.round(e.b - e.a) + ' s · ' + Math.round(e.score * 100) + ' %', e.on, v => { e.on = v; });
            const go = h('button', { class: 'action quiet', title: _T('Amener la tête de lecture au début') }, '▶');
            go.addEventListener('click', () => seek(e.a));
            list.appendChild(h('div', { class: 'ex-item' }, h('div', { class: 'ex-head' }, cb, go), e.title ? h('div', { class: 'note' }, _T('« ') + e.title + _T(' »')) : null));
          });
        };
        const scan = h('button', { class: 'action' }, _T('Trouver les passages'));
        scan.addEventListener('click', () => findExtracts(redraw));
        const make = h('button', { class: 'action go' }, _T('Créer les extraits'));
        make.addEventListener('click', makeExtracts);
        box.append(
          h('div', { class: 'note' }, _T('Sélectionne les plans d\'une longue vidéo (podcast, interview, live) : RR FX écoute la voix et propose ses meilleurs passages, du début d\'une phrase à la fin d\'une autre. Avec un .srt (onglet Parole), il choisit aussi les passages aux mots forts.')),
          row(_T('Combien'), hotText({ value: x.count, min: 1, max: 10, step: 1, unit: '', onChange: v => { x.count = v; app.persist(); } })),
          row(_T('Durée'), h('span', { class: 'row-pair' }, hotText({ value: x.min, min: 10, max: 120, step: 5, unit: 's min', onChange: v => { x.min = v; app.persist(); } }), hotText({ value: x.max, min: 15, max: 180, step: 5, unit: 's max', onChange: v => { x.max = v; app.persist(); } }))),
          h('div', { class: 'row-buttons wrap' },
            checkbox(_T('Copie au format choisi plus haut'), x.exFormat, v => { x.exFormat = v; app.persist(); }),
            checkbox(_T('Sous-titres (si un .srt est chargé)'), x.exCaptions, v => { x.exCaptions = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, scan, make), list);
        redraw();
        return [box];
      }
    });

    // ---------------------------------------------------------------- vérifier avant export

    /* Image de chaque plan (jusqu'à 12) : sous- ou surexposée, dominante de couleur. */
    async function imageIssues() {
      const G = root.RRFXAuto, TICKS = 254016000000;
      if (!G || !app.services.grabClean) return [];
      const l = await Host.call('rushList', { scope: 'sequence' });
      if (!l.ok || !l.clips.length) return [];
      const pick = l.clips.length <= 12 ? l.clips : Array.from({ length: 12 }, (_, i) => l.clips[Math.round(i * (l.clips.length - 1) / 11)]);
      app.status.phase(_T('Image des plans'));
      const frames = await app.services.grabClean(pick.map(c => (c.start + c.end) / 2 / TICKS), 3, 240);
      const out = [];
      frames.forEach((f, i) => {
        if (!f || !f.data) return;
        const c = pick[i], p = G.autoParams(G.analyze(f.data), { levels: false }), warm = p.gain[0] / p.gain[2];
        const where = 'V' + (c.track + 1), t = c.start / TICKS, name = c.name;
        if (p.ev >= 0.6) out.push({ level: 'warn', t, where, text: _T('Plan sous-exposé (≈ +') + p.ev.toFixed(1).replace('.', ',') + _T(' IL à corriger) : ') + name });
        else if (p.ev <= -0.6) out.push({ level: 'warn', t, where, text: _T('Plan surexposé (≈ ') + p.ev.toFixed(1).replace('.', ',') + _T(' IL à corriger) : ') + name });
        if (warm >= 1.15) out.push({ level: 'warn', t, where, text: _T('Dominante froide (bleue) : ') + name });
        else if (warm <= 0.87) out.push({ level: 'warn', t, where, text: _T('Dominante chaude (orange) : ') + name });
      });
      return out;
    }

    let lastCheck = null;
    function preflight(redraw) {
      return app.runTask(_T('Vérification avant export'), async () => {
        const r = await Host.call('preflight', {});
        if (!r.ok) return { kind: 'error', title: _T('Vérification impossible'), detail: r.error };
        if (st().pfImage) {
          try { r.issues = r.issues.concat(await imageIssues()).sort((a, b) => a.t - b.t); } catch (e) { app.log(_T('Image des plans : ') + app.errorMessage(e), 'warn'); }
        }
        lastCheck = r;
        if (redraw) redraw();
        const err = r.issues.filter(i => i.level === 'error').length, warn = r.issues.length - err;
        if (!r.issues.length) return { kind: 'ok', title: _T('Prêt à exporter'), detail: _T('Aucun média hors ligne, aucune image noire, rien de coupé ni de poussé trop fort.') };
        return { kind: err ? 'error' : 'warn', title: [err ? app.plural(err, _T('problème')) : '', warn ? app.plural(warn, _T('remarque')) : ''].filter(Boolean).join(_T(' et ')), detail: _T('Clique sur une ligne pour y amener la tête de lecture.') };
      });
    }
    app.extras.formats.push({
      id: 'verif', title: _T('Vérifier avant export'), nav: _T('Vérifier'),
      render: () => {
        const box = h('div'), list = h('div', { class: 'pf-list' });
        const redraw = () => {
          list.innerHTML = '';
          if (!lastCheck) return;
          if (!lastCheck.issues.length) { list.appendChild(h('div', { class: 'note pf-ok' }, _T('✓ Rien à signaler sur ') + mmss(lastCheck.duration) + _T(' de séquence.'))); return; }
          lastCheck.issues.forEach(i => {
            const b = h('button', { class: 'pf-item ' + i.level, title: _T('Aller à ') + mmss(i.t) }, h('span', { class: 'pf-icon' }, i.level === 'error' ? '✕' : '!'), h('span', { class: 'pf-time' }, mmss(i.t) + ' · ' + i.where), h('span', { class: 'pf-text' }, i.text));
            b.addEventListener('click', () => seek(i.t));
            list.appendChild(b);
          });
        };
        const go = h('button', { class: 'action go' }, _T('Vérifier la séquence'));
        go.addEventListener('click', () => preflight(redraw));
        const x = st();
        box.append(h('div', { class: 'note' }, _T('Avant d\'envoyer à Media Encoder : médias hors ligne, images noires (trous sans plan), clips désactivés, pistes masquées ou coupées, volume poussé au-delà de +6 dB, textes RR FX hors de la zone sûre.')),
          checkbox(_T('Vérifier aussi l\'image : plans trop sombres, trop clairs, dominante de couleur (Couleur > Expo et balance auto pour corriger)'), x.pfImage, v => { x.pfImage = v; app.persist(); }),
          h('div', { class: 'row-buttons' }, go), list);
        redraw();
        return [box];
      }
    });

    // ---------------------------------------------------------------- plusieurs séquences

    const BATCH = [
      { id: 'applyLook', label: _T('Le look en cours (toute la séquence)') },
      { id: 'convert', label: _T('La conversion LOG (toute la séquence)') },
      { id: 'formatCopy', label: _T('Une copie au format choisi') },
      { id: 'preflight', label: _T('La vérification avant export') },
      { id: 'beats', label: _T('Les marqueurs des temps forts') }
    ];
    let seqs = null;
    async function loadSeqs(redraw) {
      const r = await Host.call('listSequences', {});
      seqs = r.ok ? r.sequences : [];
      if (redraw) redraw();
    }
    async function runBatch() {
      const x = st(), list = (seqs || []).filter(q => x.picked.indexOf(q.id) >= 0), what = BATCH.find(b => b.id === x.batch);
      if (app.S.busy) return;
      if (!list.length) return app.status.finish('warn', _T('Aucune séquence cochée'), _T('Coche les séquences à traiter.'));
      const fn = x.batch === 'preflight' ? () => preflight(null) : app.actions[x.batch];
      if (!fn) return app.status.finish('error', _T('Action indisponible'), what.label);
      const s = app.settings(), keep = { color: s.color && s.color.target, log: s.logconv && s.logconv.scope };
      // Look et conversion sur toute la séquence pendant le lot, comme si tu l'avais choisi.
      if (s.color) s.color.target = 'sequence';
      if (s.logconv) s.logconv.scope = 'sequence';
      const report = [], back = await Host.call('getContext', {});
      try {
        for (const q of list) {
          if (app.S.cancel) break;
          const o = await Host.call('openSequence', { id: q.id });
          if (!o.ok) { report.push(q.name + ' : ' + o.error); continue; }
          const r = await fn();
          report.push(q.name + ' : ' + (r ? r.title : _T('occupé')));
          app.log(_T('Lot · ') + q.name + ' : ' + (r ? r.title + (r.detail ? ' (' + r.detail + ')' : '') : _T('panneau occupé')), r && r.kind === 'error' ? 'error' : r && r.kind === 'warn' ? 'warn' : 'ok');
        }
      } finally {
        if (s.color) s.color.target = keep.color;
        if (s.logconv) s.logconv.scope = keep.log;
        app.persist();
        if (back.ok && back.seqId && x.batch !== 'formatCopy') await Host.call('openSequence', { id: back.seqId });
      }
      app.status.finish('ok', what.label.replace(/ \(.*\)$/, '') + ' · ' + app.plural(report.length, _T('séquence')), report.join(' · '));
    }
    app.extras.formats.push({
      id: 'lot', title: _T('Sur plusieurs séquences'), nav: _T('Lot'), shut: true,
      render: () => {
        const x = st(), box = h('div'), list = h('div', { class: 'seq-list' });
        const redraw = () => {
          list.innerHTML = '';
          if (!seqs) { list.appendChild(h('div', { class: 'note' }, _T('Clique sur « Lister les séquences ».'))); return; }
          seqs.forEach(q => list.appendChild(checkbox(q.name + ' · ' + q.w + '×' + q.h + ' · ' + mmss(q.end), x.picked.indexOf(q.id) >= 0, v => {
            const i = x.picked.indexOf(q.id);
            if (v && i < 0) x.picked.push(q.id); else if (!v && i >= 0) x.picked.splice(i, 1);
            app.persist();
          })));
        };
        const load = h('button', { class: 'action' }, _T('Lister les séquences'));
        load.addEventListener('click', () => loadSeqs(redraw));
        const go = h('button', { class: 'action go' }, _T('Lancer sur les séquences cochées'));
        go.addEventListener('click', runBatch);
        box.append(
          h('div', { class: 'note' }, _T('La même opération sur plusieurs séquences du projet, l\'une après l\'autre : RR FX ouvre chaque séquence et fait le travail. Chaque opération reste annulable dans l\'historique 🕘.')),
          row(_T('Appliquer'), picker(BATCH.map(b => ({ v: b.id, label: b.label })), x.batch, v => { x.batch = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, load), list, h('div', { class: 'row-buttons' }, go));
        redraw();
        return [box];
      }
    });

    // ---------------------------------------------------------------- modèles de projet

    const TEMPLATES = [
      { id: 'interview', name: _T('Interview / témoignage'), format: '16x9', recipe: 'interview', capStyle: 'b:blanc', lowerStyle: 'b:bloc', icon: '🎙' },
      { id: 'reels', name: 'Reels / TikTok', format: '9x16', recipe: 'reels', capStyle: 'b:reels', lowerStyle: 'b:reels', icon: '📱' },
      { id: 'youtube', name: 'YouTube face cam', format: '16x9', recipe: 'youtube', capStyle: 'b:reels', lowerStyle: 'b:bloc', icon: '▶' },
      { id: 'podcast', name: _T('Podcast vidéo'), format: '16x9', recipe: 'interview', capStyle: 'b:blanc', lowerStyle: 'b:corporate', icon: '🎧' },
      { id: 'corporate', name: _T('Vidéo d\'entreprise'), format: '16x9', recipe: 'corporate', capStyle: 'b:corporate', lowerStyle: 'b:corporate', icon: '🏢' },
      { id: 'aftermovie', name: _T('Aftermovie / clip'), format: '16x9', recipe: 'aftermovie', capStyle: 'b:blanc', lowerStyle: 'b:blanc', icon: '🎉' }
    ];
    const userTemplates = () => app.S.lib.items.filter(i => i.type === 'projectTemplate').map(i => Object.assign({}, i.data, { id: 'u:' + i.id, name: '★ ' + i.name, icon: '★' }));
    const templateById = id => (id && id.indexOf('u:') === 0 ? userTemplates().find(t => t.id === id) : TEMPLATES.find(t => 'b:' + t.id === id)) || TEMPLATES[0];

    function createFromTemplate(t) {
      return app.runTask(_T('Nouveau projet · ') + t.name.replace(/^★ /, ''), async () => {
        const F = app.formats ? app.formats.FORMATS.find(f => f.id === t.format) : null, d = new Date();
        const name = t.name.replace(/^★ /, '') + ' · ' + d.toLocaleDateString();
        const r = await Host.call('newFromTemplate', { name, width: F ? F.w : 0, height: F ? F.h : 0, adj: true, adjNodeId: app.settings().adjNodeId });
        if (!r.ok) return { kind: 'error', title: _T('Séquence non créée'), detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        // Les réglages du modèle : style Express, styles des textes, format des copies.
        const s = app.settings();
        if (t.recipe) { s.express = s.express || {}; s.express.recipe = t.recipe; }
        if (app.speech && t.capStyle !== undefined) { app.speech.settings().capStyle = t.capStyle; app.speech.settings().lowerStyle = t.lowerStyle || ''; }
        if (t.titleStyle !== undefined) { s.titles = s.titles || {}; s.titles.style = t.titleStyle; }
        if (app.formats && t.format) app.formats.settings().id = t.format;
        app.persist();
        return { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', title: _T('« ') + r.name + _T(' » créée'), detail: (r.clips ? app.plural(r.clips, _T('rush placé'), _T('rushs placés')) : _T('Séquence vide aux bons réglages')) + (r.adjPlaced ? _T(', calque de réglage posé') : '') + _T('. Style Express et styles des textes du modèle choisis : onglet Express pour lancer le montage.') };
      });
    }

    app.extras.formats.push({
      id: 'modeles', title: _T('Nouveau projet depuis un modèle'), nav: _T('Modèles'),
      render: () => {
        const x = st(), box = h('div');
        const draw = () => {
          box.innerHTML = '';
          const all = userTemplates().concat(TEMPLATES.map(t => Object.assign({}, t, { id: 'b:' + t.id })));
          const cards = h('div', { class: 'tpl-cards' }, all.map(t => {
            const F = app.formats ? app.formats.FORMATS.find(f => f.id === t.format) : null;
            const c = h('button', { class: 'tpl-card' + (t.id === x.template ? ' on' : '') }, h('span', { class: 'tpl-icon' }, t.icon || '★'), h('b', null, t.name), h('span', { class: 'note' }, (F ? F.label : '') + (t.recipe ? ' · ' + ((root.RRFXRecipes.byId(t.recipe) || {}).name || '') : '')));
            c.addEventListener('click', () => { x.template = t.id; app.persist(); draw(); });
            return c;
          }));
          const go = h('button', { class: 'action go' }, _T('Créer la séquence'));
          go.addEventListener('click', () => createFromTemplate(templateById(x.template)));
          const save = h('button', { class: 'action', title: _T('Format, style Express et styles des textes choisis en ce moment') }, _T('Enregistrer mes réglages comme modèle…'));
          save.addEventListener('click', async () => {
            const name = await app.promptName(_T('Nom du modèle'), _T('Mon modèle'));
            if (!name) return;
            const s = app.settings(), sp = app.speech ? app.speech.settings() : {};
            app.services.addItems([{ type: 'projectTemplate', name, data: { format: app.formats ? app.formats.settings().id : '16x9', recipe: s.express && s.express.recipe ? s.express.recipe : '', capStyle: sp.capStyle || '', lowerStyle: sp.lowerStyle || '', titleStyle: (s.titles && s.titles.style) || '' } }]);
            const it = app.S.lib.items.filter(i => i.type === 'projectTemplate' && i.name === name).pop();
            if (it) x.template = 'u:' + it.id;
            app.persist();
            draw();
            app.status.finish('ok', _T('Modèle « ') + name + _T(' » enregistré'), _T('Dans Mes effets : exportable et partageable.'));
          });
          box.append(
            h('div', { class: 'note' }, _T('Sélectionne tes rushs dans le panneau Projet : RR FX crée la séquence au bon format avec eux, pose le calque de réglage, et choisit le style Express et les styles des textes du modèle. Sans rushs sélectionnés : une séquence vide aux réglages de la séquence ouverte.')),
            cards, h('div', { class: 'row-buttons wrap' }, go, save));
        };
        draw();
        return [box];
      }
    });
    app.itemTypes.projectTemplate = {
      icon: '▦', label: _T('Modèle de projet'), valid: d => !!d && typeof d.format === 'string',
      meta: it => [it.data.format.replace('x', ':'), (root.RRFXRecipes.byId(it.data.recipe) || {}).name].filter(Boolean).join(' · '),
      open: it => { st().template = 'u:' + it.id; app.persist(); app.switchTab('formats'); }
    };

    app.actions.extracts = makeExtracts;
    app.actions.preflight = () => preflight(() => { if (app.S.tab === 'formats') app.switchTab('formats'); });
  });
})(typeof self !== 'undefined' ? self : this);
