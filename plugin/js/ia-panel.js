/* RR FX : l'IA locale (Ollama) dans le panneau. Rien n'est envoyé en ligne.
   - app.ia : traduction et correction des sous-titres, titres des chapitres, choix des extraits
     (utilisés par traduire.js, raccords.js, parole.js, formatsplus.js) ;
   - Parole › Publier : titre, description et hashtags écrits d'après ce qui est dit ;
   - Bibliothèque › Recherche : chaque rush décrit par l'IA (une image), puis cherché par le sens
     (« plage au coucher du soleil »), et plans de coupe posés tout seuls sur les phrases.
   Demandes et réponses : ia.js. Lancement d'Ollama et modèles : outils-panel.js. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const IA = root.RRFXIA, Lb = root.RRFXLibres, Sp = root.RRFXSpeech, { Store, Host } = app;
    const { h, row, actionGroup } = app.UI;
    const uiLang = () => (root.RRFXI18n && root.RRFXI18n.lang) || 'fr';
    // Langue de ce qui est dit : celle choisie pour Whisper, sinon celle du panneau.
    const spokenLang = () => { const w = app.settings().whisper; return w && w.lang && w.lang !== 'auto' ? w.lang : uiLang(); };
    const O = () => app.tools.ollama;
    const st = () => {
      const s = app.settings();
      if (!s.ia || typeof s.ia !== 'object') s.ia = {};
      const d = { platform: 'youtube', density: 8, strict: 'normal', source: 'project', query: '' };
      Object.keys(d).forEach(k => { if (!(k in s.ia)) s.ia[k] = d[k]; });
      return s.ia;
    };

    /* Lignes envoyées par groupes ; un groupe mal rendu (nombre de lignes différent) est coupé en
       deux et redemandé ; une ligne seule qui échoue reste telle quelle. */
    async function lineJob(build, texts, label) {
      const model = await O().ready('text', label);
      const out = texts.slice(), todo = IA.groups(texts, 25, 3000);
      let done = 0, kept = 0;
      while (todo.length) {
        if (app.S.cancel) throw new Error(_T('Arrêté'));
        const g = todo.shift(), q = build(g.map(i => texts[i]));
        app.status.progress(done, texts.length, label);
        let l = null;
        // Réponse illisible : redemandée en plus petit ; Ollama en panne ou arrêt : on s'arrête là.
        try { l = IA.lines(await O().chat(model, q.messages, { format: q.format }), g.length); } catch (e) { if (!e.unreadable) throw e; l = null; }
        if (l) { g.forEach((i, k) => { out[i] = l[k] || texts[i]; }); done += g.length; continue; }
        if (g.length > 1) { const m = g.length >> 1; todo.unshift(g.slice(0, m), g.slice(m)); continue; }
        kept++; done++;
      }
      if (kept) app.log(app.plural(kept, _T('ligne laissée telle quelle'), _T('lignes laissées telles quelles')) + _T(' (réponse de l\'IA illisible).'), 'warn');
      return out;
    }

    const translate = (texts, from, to) => lineJob(t => IA.translate(t, from, to), texts, _T('Traduction (IA locale)'));
    const correct = (texts, lang) => lineJob(t => IA.correct(t, lang || spokenLang()), texts, _T('Correction (IA locale)'));

    // Titres des chapitres d'après ce qui est dit (list : [{ t, title }]).
    async function chapters(list, cues, end) {
      const model = await O().ready('text', _T('L\'IA écrit le titre de chaque chapitre.'));
      app.status.phase(_T('Titres des chapitres (IA locale)'));
      const q = IA.chapters(list, cues, spokenLang(), end);
      return IA.chapterTitles(await O().chat(model, q.messages, { format: q.format, temperature: 0.4 }), list) || list;
    }

    // Extraits : candidats [{ a, b, text }] → les count meilleurs (index, titre).
    async function extracts(cands, count) {
      const model = await O().ready('text', _T('L\'IA choisit les passages qui tiennent seuls.'));
      app.status.phase(_T('Choix des extraits (IA locale)'));
      const q = IA.extracts(cands, count, spokenLang());
      return IA.picks(await O().chat(model, q.messages, { format: q.format, ctx: 16384 }), cands.length, count);
    }

    // Correcteur : toutes les lignes du .srt relues par l'IA (orthographe, noms, ponctuation).
    function correctSubs(refresh) {
      return app.runTask(_T('Correction des sous-titres (IA locale)'), async () => {
        const sp = app.speech.settings(), cues = Sp.parseSubtitles(sp.srt), Tr = root.RRFXTraduction;
        if (!cues.length) return { kind: 'warn', title: _T('Pas de sous-titres'), detail: _T('Importe ou colle d\'abord un .srt (section Sous-titres).') };
        const before = cues.map(c => Tr.oneLine(c.text)), after = await correct(before);
        const changed = after.filter((t, i) => t !== before[i]).length;
        if (changed) {
          sp.srt = Tr.toSrt(Tr.apply(cues, after));
          app.persist();
        }
        if (refresh) refresh();
        return { kind: 'ok', title: changed ? app.plural(changed, _T('sous-titre corrigé'), _T('sous-titres corrigés')) : _T('Rien à corriger'), detail: _T('Orthographe, accents, ponctuation et noms mal entendus. Relis avant de poser les sous-titres.') };
      }, true);
    }

    app.ia = { translate, correct, chapters, extracts, correctSubs, spokenLang };

    // ---------------------------------------------------------------- Parole › Publier

    let pub = null;
    function writePublish(redraw) {
      const x = st();
      return app.runTask(_T('Titre et description (IA locale)'), async () => {
        const words = app.transcript && app.transcript.has() ? app.transcript.words().map(w => w.text).join(' ') : '';
        const text = words || Sp.parseSubtitles(app.speech.settings().srt).map(c => c.text).join(' ');
        if (text.trim().length < 80) return { kind: 'warn', title: _T('Pas assez de texte'), detail: _T('Transcris la vidéo (Parole › Transcrire) ou charge son .srt : l\'IA écrit d\'après ce qui est dit.') };
        const model = await O().ready('text', _T('L\'IA écrit le titre, la description et les hashtags d\'après ce qui est dit.'));
        app.status.phase(_T('Écriture (IA locale)'));
        const q = IA.publish(text, spokenLang(), x.platform);
        const r = IA.publishResult(await O().chat(model, q.messages, { format: q.format, temperature: 0.7, ctx: 16384 }));
        if (!r) throw new Error(_T('Réponse de l\'IA illisible'));
        pub = r;
        if (redraw) redraw();
        return { kind: 'ok', title: _T('Textes prêts'), detail: _T('Copie ce qui te plaît et retouche-le : l\'IA peut se tromper.') };
      }, true);
    }
    const copyText = (t, what) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error(_T('presse-papiers indisponible'))))
      .then(() => app.status.finish('ok', what + _T(' copié'), ''), e => app.status.finish('warn', _T('Copie impossible'), app.errorMessage(e)));

    app.extras.speech.push({
      id: 'publier', title: _T('Titre, description et hashtags (IA locale)'), nav: _T('Publier'), tool: [_T('Écrire les textes'), () => writePublish()],
      render: () => {
        const x = st(), out = h('div');
        const draw = () => {
          out.innerHTML = '';
          if (!pub) return;
          pub.titles.forEach(t => {
            const b = h('button', { class: 'action quiet', title: _T('Copier') }, '⧉');
            b.addEventListener('click', () => copyText(t, _T('Titre')));
            out.appendChild(h('div', { class: 'ia-line' }, h('span', null, t), b));
          });
          const desc = h('textarea', { class: 'code', rows: 6, spellcheck: 'true' }, pub.description + (pub.hashtags.length ? '\n\n' + pub.hashtags.join(' ') : ''));
          const all = h('button', { class: 'action' }, _T('Copier la description'));
          all.addEventListener('click', () => copyText(desc.value, _T('Texte')));
          out.append(desc, h('div', { class: 'row-buttons' }, all));
        };
        const go = h('button', { class: 'action go' }, _T('Écrire les textes'));
        go.addEventListener('click', () => writePublish(draw));
        draw();
        return [
          h('div', { class: 'note' }, _T('D\'après ce qui est dit (transcription ou .srt) : 3 idées de titre, une description et des hashtags, écrits par l\'IA sur ton ordinateur.')),
          row(_T('Pour'), actionGroup([{ v: 'youtube', label: 'YouTube' }, { v: 'reels', label: _T('Reels / TikTok') }, { v: 'linkedin', label: 'LinkedIn' }], x.platform, v => { x.platform = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go), out
        ];
      }
    });

    // ---------------------------------------------------------------- Bibliothèque › Recherche

    const INDEX = 'index-rushs.json';
    const STRICT = { soft: 0.4, normal: 0.48, strict: 0.56 };
    let index = null;
    const loadIndex = () => {
      if (index) return index;
      const r = Store.readJSON(INDEX);
      index = r && r.items ? r : { version: 1, items: {} };
      return index;
    };
    const saveIndex = () => { try { Store.writeJSON(INDEX, index); } catch (e) { app.log(_T('Index des rushs non enregistré : ') + app.errorMessage(e), 'warn'); } };
    const sig = p => { try { const s = Store.fs.statSync(p); return s.size + ':' + Math.round(s.mtimeMs); } catch (e) { return ''; } };

    async function rushesToIndex(source) {
      if (source === 'sequence') {
        const r = await Host.call('rushList', { scope: 'sequence' });
        if (!r.ok) throw new Error(r.error);
        const seen = new Set();
        return r.clips.filter(c => c.path && !seen.has(c.path) && seen.add(c.path)).map(c => ({ name: c.name, path: c.path }));
      }
      const r = await Host.call('projectRushes', {});
      if (!r.ok) throw new Error(r.error);
      if (!r.rushes.length) throw new Error(_T('Sélectionne des rushs dans le panneau Projet.'));
      return r.rushes.filter(x => x.path).map(x => ({ name: x.name, path: x.path }));
    }

    function indexRushes(redraw) {
      const x = st();
      return app.runTask(_T('Description des rushs (IA locale)'), async () => {
        if (!Store.fs) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('Les rushs sont décrits sur ton ordinateur, depuis Premiere.') };
        const list = await rushesToIndex(x.source), idx = loadIndex(), o = O().settings();
        const todo = list.filter(r => { const it = idx.items[r.path]; return !it || it.sig !== sig(r.path) || it.vision !== o.vision || it.embed !== o.embed; });
        if (!todo.length) return { kind: 'ok', title: _T('Déjà décrits'), detail: app.plural(list.length, _T('rush')) + _T(' dans l\'index.') };
        const ff = await app.tools.need('ffmpeg', _T('ffmpeg prend une image de chaque rush.'));
        const vision = await O().ready('vision', _T('L\'IA décrit une image de chaque rush.'));
        const embedM = await O().ready('embed', _T('Ce modèle range les descriptions par le sens.'));
        const dir = app.tools.work('vignettes');
        let n = 0, failed = 0;
        try {
          for (const r of todo) {
            if (app.S.cancel) break;
            app.status.progress(n, todo.length, _T('Rush ') + (n + 1) + '/' + todo.length + ' · ' + r.name);
            try {
              const info = await app.tools.probe(r.path), jpg = Store.path.join(dir, (n + 1) + '.jpg');
              await app.tools.run(ff, Lb.ffThumb(r.path, jpg, { at: info.dur > 1 ? info.dur / 2 : 0 }));
              const img = Store.fs.readFileSync(jpg).toString('base64'), q = IA.describe(spokenLang());
              const desc = IA.description(await O().chat(vision, [Object.assign({}, q.messages[0], { images: [img] })], { format: q.format }));
              if (!desc) throw new Error(_T('pas de description'));
              const vec = (await O().embed(embedM, [r.name + ' · ' + desc]))[0];
              loadIndex().items[r.path] = { name: r.name, desc, vec, sig: sig(r.path), vision: o.vision, embed: o.embed, at: Date.now() };
              if (++n % 5 === 0) saveIndex();
            } catch (e) {
              if (app.S.cancel) break;
              failed++;
              app.log(r.name + ' : ' + app.errorMessage(e), 'warn');
            }
          }
        } finally { saveIndex(); app.tools.clean(dir); }
        if (redraw) redraw();
        return { kind: failed ? 'warn' : 'ok', title: app.plural(n, _T('rush décrit'), _T('rushs décrits')), detail: (failed ? app.plural(failed, _T('rush illisible'), _T('rushs illisibles')) + _T(' (voir le journal). ') : '') + _T('Cherche-les par ce qu\'ils montrent, ou pose les plans de coupe sur les phrases.') };
      }, true);
    }

    let results = [];
    function search(q, redraw) {
      return app.runTask(_T('Recherche dans les rushs'), async () => {
        const items = Object.keys(loadIndex().items).map(p => Object.assign({ path: p }, index.items[p]));
        if (!items.length) return { kind: 'warn', title: _T('Aucun rush décrit'), detail: _T('Clique d\'abord sur « Décrire les rushs ».') };
        if (!String(q).trim()) return { kind: 'warn', title: _T('Que cherches-tu ?'), detail: _T('Décris le plan voulu : « gros plan des mains », « rue la nuit »…') };
        const model = await O().ready('embed');
        const vec = (await O().embed(model, [q]))[0];
        results = IA.nearest(vec, items.filter(i => i.embed === O().settings().embed), 8);
        if (redraw) redraw();
        return { kind: results.length ? 'ok' : 'warn', title: app.plural(results.length, _T('rush trouvé'), _T('rushs trouvés')), detail: results.length ? _T('Les plus proches d\'abord. « Poser » le met à la tête de lecture.') : _T('Décris à nouveau les rushs avec le modèle de recherche choisi.') };
      });
    }

    async function placeRush(r, t, dur) {
      const res = await Host.call('placeAsset', { kind: 'video', path: r.path, name: r.name, times: [t], dur });
      if (!res.ok) throw new Error(res.error);
      return res.created;
    }

    function autoBroll() {
      const x = st();
      return app.runTask(_T('Plans de coupe automatiques (IA locale)'), async () => {
        const items = Object.keys(loadIndex().items).map(p => Object.assign({ path: p }, index.items[p])).filter(i => i.embed === O().settings().embed);
        if (!items.length) return { kind: 'warn', title: _T('Aucun rush décrit'), detail: _T('Décris d\'abord tes plans de coupe (« Décrire les rushs »).') };
        const cues = await app.speech.timedCues();
        if (!cues.length) return { kind: 'warn', title: _T('Pas de phrases'), detail: _T('Transcris la vidéo ou charge son .srt (onglet Parole) : chaque phrase cherche le rush qui lui ressemble.') };
        const model = await O().ready('embed');
        app.status.phase(_T('Sens de chaque phrase'));
        for (let i = 0; i < cues.length; i += 64) {
          const part = cues.slice(i, i + 64), vecs = await O().embed(model, part.map(c => String(c.text).replace(/\s+/g, ' ')));
          part.forEach((c, k) => { c.vec = vecs[k]; });
          app.status.progress(Math.min(cues.length, i + 64), cues.length, _T('Sens de chaque phrase'));
        }
        const plan = IA.broll(cues, items, { min: STRICT[x.strict] || 0.48, every: x.density });
        if (!plan.length) return { kind: 'warn', title: _T('Aucun rush assez proche'), detail: _T('Décris plus de rushs, ou choisis une exigence plus souple.') };
        const created = [];
        for (let i = 0; i < plan.length; i++) {
          if (app.S.cancel) break;
          const p = plan[i];
          app.status.progress(i, plan.length, _T('Pose de ') + p.rush.name);
          try { created.push(...await placeRush(p.rush, p.t, p.dur)); } catch (e) { app.log(p.rush.name + ' : ' + app.errorMessage(e), 'warn'); }
          app.log(IA.stamp(p.t) + ' → ' + p.rush.name + ' (' + Math.round(p.score * 100) + ' %)', 'info');
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: _T('Plans de coupe IA × ') + created.length, entries: created });
        return { kind: created.length ? 'ok' : 'warn', title: app.plural(created.length, _T('plan de coupe posé'), _T('plans de coupe posés')), detail: _T('Au-dessus de l\'interview, sur les phrases qui leur ressemblent (détail dans le journal). ↶ Annuler les retire.') };
      }, true);
    }

    app.extras.assets.push({
      id: 'recherche', title: _T('Chercher dans les rushs (IA locale)'), nav: _T('Recherche'), tool: [_T('Plans de coupe automatiques'), () => autoBroll()],
      render: () => {
        const x = st(), list = h('div', { class: 'ia-results' });
        const count = () => Object.keys(loadIndex().items).length;
        const info = h('div', { class: 'note' });
        const draw = () => {
          info.textContent = app.plural(count(), _T('rush décrit'), _T('rushs décrits')) + _T(' dans l\'index (Documents/RRFX).');
          list.innerHTML = '';
          results.forEach(r => {
            const put = h('button', { class: 'action quiet' }, _T('Poser'));
            put.addEventListener('click', () => app.runTask(_T('Pose de ') + r.item.name, async () => {
              const m = await Host.call('markerList', {});
              const created = await placeRush(r.item, m.ok ? m.playhead : 0, 4);
              app.pushHistory({ date: Date.now(), label: _T('Rush · ') + r.item.name, entries: created });
              return { kind: 'ok', title: _T('« ') + r.item.name + _T(' » posé'), detail: _T('4 s à la tête de lecture, au-dessus des autres plans.') };
            }));
            const show = h('button', { class: 'action quiet' }, _T('Montrer'));
            show.addEventListener('click', () => Store.reveal(r.item.path));
            list.appendChild(h('div', { class: 'ia-result' },
              h('div', { class: 'ia-line' }, h('strong', null, r.item.name), h('span', { class: 'badge' }, Math.round(r.score * 100) + ' %'), put, show),
              h('div', { class: 'note' }, r.item.desc)));
          });
        };
        const idx = h('button', { class: 'action' }, _T('Décrire les rushs'));
        idx.addEventListener('click', () => indexRushes(draw));
        const q = h('input', { class: 'textfield', value: x.query, placeholder: _T('ex. gros plan des mains, rue la nuit, drone sur la mer…'), 'aria-label': _T('Rush recherché') });
        const go = h('button', { class: 'action go' }, _T('Chercher'));
        const run = () => { x.query = q.value.trim(); app.persist(); search(x.query, draw); };
        go.addEventListener('click', run);
        q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
        const auto = h('button', { class: 'action go' }, _T('Poser les plans de coupe'));
        auto.addEventListener('click', autoBroll);
        const clear = h('button', { class: 'action quiet' }, _T('Vider l\'index'));
        clear.addEventListener('click', async () => {
          if (!(await app.confirmDialog(_T('Vider l\'index ?'), _T('Les descriptions des rushs sont effacées (pas les rushs).'), _T('Vider')))) return;
          index = { version: 1, items: {} }; saveIndex(); results = []; draw();
        });
        draw();
        return [
          h('div', { class: 'note' }, _T('L\'IA regarde une image de chaque rush et la décrit ; tu les retrouves ensuite par ce qu\'ils montrent. Tout se passe sur ton ordinateur (Ollama).')),
          row(_T('Rushs'), actionGroup([{ v: 'project', label: _T('Sélection du panneau Projet') }, { v: 'sequence', label: _T('Ceux de la séquence') }], x.source, v => { x.source = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, idx, clear), info,
          h('div', { class: 'ia-search' }, q, go), list,
          h('div', { class: 'note' }, _T('Plans de coupe automatiques : chaque phrase de la transcription (ou du .srt) cherche le rush qui lui ressemble ; il est posé au-dessus, pendant la phrase.')),
          row(_T('Un plan'), actionGroup([{ v: 5, label: _T('toutes les 5 s') }, { v: 8, label: _T('8 s') }, { v: 15, label: _T('15 s') }], x.density, v => { x.density = v; app.persist(); })),
          row(_T('Exigence'), actionGroup([{ v: 'soft', label: _T('Souple') }, { v: 'normal', label: _T('Normale') }, { v: 'strict', label: _T('Stricte') }], x.strict, v => { x.strict = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, auto)
        ];
      }
    });

    app.actions.autoBroll = () => autoBroll();
    app.actions.writePublish = () => writePublish();
  });
})(typeof self !== 'undefined' ? self : this);
