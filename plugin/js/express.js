/* RR FX : onglet Express. Ton montage en un clic, pour tout type de vidéo (Reels, interview,
   vidéo d'entreprise, aftermovie, YouTube, clip musical…) : choisis un style, RR FX enchaîne ce que
   le plugin sait faire (silences coupés, temps forts, montage sur le rythme, conversion LOG,
   expo, look, zooms sur les jump cuts, effets enchaînés, sons, paroles, sous-titres, bandeau,
   copie au format réseau). Chaque étape reste une opération séparée : ↶ Annuler en retire une à
   la fois, et tes réglages des autres onglets sont rendus tels quels à la fin. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const R = root.RRFXRecipes, D = root.RRFXDevelop, A = root.RRFXAssets, { Host, Pv } = app;
    const { h, section, checkbox } = app.UI;
    const st = () => {
      // Complète sans remplacer l'objet (l'interface garde une référence dessus).
      const s = app.settings();
      if (!s.express || typeof s.express !== 'object') s.express = {};
      if (!s.express.recipe) s.express.recipe = R.RECIPES[0].id;
      if (!s.express.picks || typeof s.express.picks !== 'object') s.express.picks = {};
      return s.express;
    };
    // Tes styles enregistrés (Mes effets) : « u:<id> ».
    const userRecipes = () => app.S.lib.items.filter(i => i.type === 'xpStyle').map(i => Object.assign({}, i.data.recipe, { id: 'u:' + i.id, name: '★ ' + i.name, desc: i.data.recipe.desc || 'Ton style enregistré.' }));
    const recipe = () => {
      const id = st().recipe;
      if (id === 'mine') return R.fromSettings(app.settings());
      if (id && id.indexOf('u:') === 0) { const u = userRecipes().find(r => r.id === id); if (u) return u; }
      return R.byId(id) || R.RECIPES[0];
    };
    // Étapes cochées pour une recette : ton choix s'il y en a un, sinon celui de la recette.
    const picks = r => { const x = st(); if (!x.picks[r.id] || typeof x.picks[r.id] !== 'object') x.picks[r.id] = {}; return x.picks[r.id]; };
    const wants = (r, step) => { const p = picks(r); return step.id in p ? !!p[step.id] : step.on; };
    const lookParams = r => (r.look ? (D.LOOKS.find(l => l.name === r.look) || {}).p : r.lookParams) || null;
    const nameOf = key => { const e = app.services.entryByKey(key); return e ? e.name : key.slice(2); };

    // ---------------------------------------------------------------- vérifications

    let check = null; // résultat de la dernière vérification
    async function verify() {
      const s = app.settings(), out = {};
      const ctx = await Host.call('getContext', {}).catch(() => ({ ok: false }));
      out.sequence = !!(ctx.ok && ctx.hasSequence);
      out.adj = !!(ctx.ok && ctx.adj);
      const mu = out.sequence ? await Host.call('musicInfo', {}).catch(() => ({ ok: false })) : { ok: false };
      out.music = mu.ok ? mu.name : '';
      out.musicStart = mu.ok ? mu.start : 0;
      const pr = await Host.call('projectRushes', {}).catch(() => ({ ok: false }));
      out.rushes = pr.ok ? pr.rushes.length : 0;
      out.cams = ((s.logconv && s.logconv.cams) || []).length;
      out.lyrics = app.services.lyrics ? app.services.lyrics().split(/\n+/).filter(Boolean).length : 0;
      out.mogrt = !!(app.services.mogrt && app.services.mogrt());
      out.speech = out.sequence && app.services.speechClips ? await app.services.speechClips() : 0;
      out.captions = app.services.hasCaptions ? app.services.hasCaptions() : 0;
      out.lower = app.services.hasLowerThird ? app.services.hasLowerThird() : false;
      check = out;
      return out;
    }

    // Étape possible ? → '' si oui, sinon la raison.
    function blocker(id, c, r) {
      if (!c) return '';
      if (R.needsMusic(id, r || recipe()) && !c.music) return 'Pose ta musique sur une piste audio';
      if (id === 'silences' && !c.speech) return 'Sélectionne dans la timeline les plans où l\'on parle';
      if (id === 'captions' && !c.captions) return 'Importe ton .srt (onglet Parole)';
      if (id === 'lower' && !c.lower) return 'Écris le nom et la fonction (onglet Parole)';
      if ((id === 'captions' || id === 'lower') && !c.mogrt) return 'Choisis un modèle de texte (onglet Textes)';
      if (id === 'montage' && !c.rushes) return 'Sélectionne tes rushs dans le panneau Projet';
      if (id === 'convert' && !c.cams) return 'Ajoute ta caméra (onglet Couleur)';
      if (id === 'titles' && !c.lyrics) return 'Colle tes paroles (onglet Textes)';
      if (id === 'titles' && !c.mogrt) return 'Choisis un modèle de texte (onglet Textes)';
      return '';
    }

    // ---------------------------------------------------------------- étapes

    const EVERY = [1, 2, 4, 8];
    const nearest = v => EVERY.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

    async function runStep(id, r, c, on) {
      const s = app.settings();
      switch (id) {
        case 'silences':
          return app.actions.cutSilences({ mode: 'copy' });
        case 'punch':
          return app.actions.punchIn();
        case 'beats':
          Object.assign(s.beats, { mode: r.beats.mode, every: r.beats.every, zone: 'music', replace: true });
          return app.actions.beats();
        case 'montage':
          // Le montage part de la tête de lecture : on la met au début de la musique.
          await Host.call('setPlayhead', { t: c.musicStart || 0 }).catch(() => null);
          Object.assign(s.autoEdit, { source: 'markers', every: nearest(r.cut.every / r.beats.every), order: r.cut.order, pick: r.cut.pick });
          return app.actions.autoEdit();
        case 'convert':
          Object.assign(s.logconv, { mode: c.cams > 1 ? 'auto' : 'one', scope: 'sequence', autoFix: false });
          return app.actions.convert();
        case 'fix':
          s.correction.fix.scope = 'sequence';
          return app.actions.autoFix();
        case 'look': {
          const p = lookParams(r);
          if (!p) return { kind: 'warn', title: 'Pas de look dans ce style' };
          Object.assign(s.color, { params: D.normalize(JSON.parse(JSON.stringify(p))), name: r.look || r.lookName, target: 'sequence' });
          return app.actions.applyLook();
        }
        case 'effects': {
          const first = app.services.entryByKey(r.chain[0]);
          if (!first) return { kind: 'error', title: 'Style sans effet', detail: 'Compose ton enchaînement dans l\'onglet Effets (Maj + clic).' };
          Object.assign(s, { placement: r.place === 'allcuts' ? 'allcuts' : 'markers', side: 'both', vary: 'chain', sfx: on.sfx ? r.sfx : 'none', alternate: false });
          s.chain = { keys: r.chain.slice(), order: r.order };
          app.S.cur = first;
          app.S.params = Object.assign(app.services.defaultParams(first), { frames: r.frames, intensity: r.intensity });
          return app.actions.applyEffect();
        }
        case 'titles':
          Object.assign(s.titles, { timing: 'markers', from: 'start', anim: r.title });
          return app.actions.titles();
        case 'captions':
          Object.assign(s.speech, { words: (r.captions && r.captions.words) || 0, capAnim: r.title, capFrom: 'start' });
          return app.actions.captions({ remap: !!on.silences });
        case 'lower':
          await Host.call('setPlayhead', { t: 1 }).catch(() => null);
          Object.assign(s.speech, { lowerAnim: 'slide-up' });
          return app.actions.lowerThird();
        case 'format':
          Object.assign(s.formats, { id: (r.format && r.format.id) || '9x16', mode: (r.format && r.format.mode) || 'reframe' });
          return app.actions.formatCopy();
      }
      return null;
    }

    // Réglages des autres onglets que l'Express change le temps d'une étape.
    const KEEP = ['placement', 'side', 'vary', 'alternate', 'chain', 'sfx', 'beats', 'autoEdit', 'titles', 'color', 'logconv', 'correction', 'formats', 'speech'];
    const OBJECTS = ['beats', 'autoEdit', 'titles', 'color', 'logconv', 'correction', 'formats', 'speech'];

    let report = [];
    async function launch() {
      if (app.S.busy) return;
      const c = await verify();
      if (!c.sequence) return app.status.finish('error', 'Ouvre une séquence', 'Le montage express travaille sur la séquence active de Premiere.');
      if (!c.adj) return app.status.finish('error', 'Il manque un calque de réglage', 'Une fois par projet : Fichier > Nouveau > Calque de réglage. RR FX le retrouve tout seul.');
      const r = recipe(), all = R.stepsOf(r), on = {};
      all.forEach(x => { on[x.id] = wants(r, x) && !blocker(x.id, c, r); });
      const steps = all.filter(x => x.id !== 'sfx' && on[x.id]);
      if (!steps.length) {
        const why = all.filter(x => wants(r, x) && blocker(x.id, c, r)).map(x => blocker(x.id, c, r));
        return app.status.finish('warn', 'Aucune étape possible', why.length ? Array.from(new Set(why)).join(' · ') + '.' : 'Coche au moins une étape.');
      }
      const s = app.settings(), saved = {}, cur = app.S.cur, params = app.S.params;
      KEEP.forEach(k => { if (k in s) saved[k] = JSON.parse(JSON.stringify(s[k])); });
      OBJECTS.forEach(k => { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
      if (!s.correction.fix) s.correction.fix = {};
      report = [];
      const t0 = Date.now();
      app.log('Montage express · ' + r.name + ' : ' + steps.map(x => x.label).join(' → '), 'info');
      try {
        for (const step of steps) {
          const res = await runStep(step.id, r, c, on);
          report.push({ id: step.id, label: step.label, kind: res ? res.kind : 'error', title: res ? res.title : 'Panneau occupé', detail: res ? res.detail || '' : '' });
          render();
          if (app.S.cancel) { report.push({ id: 'stop', label: 'Arrêté', kind: 'warn', title: 'Les étapes suivantes n\'ont pas été faites' }); break; }
          // Sans temps forts, montage ou coupe des silences, la suite n'a pas de sens.
          if ((!res || res.kind === 'error') && (step.id === 'beats' || step.id === 'montage' || step.id === 'silences')) break;
        }
      } finally {
        Object.keys(saved).forEach(k => {
          // Les objets gardent leur identité (les onglets ont des références dessus).
          if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && typeof saved[k] === 'object') { Object.keys(s[k]).forEach(x => delete s[k][x]); Object.assign(s[k], saved[k]); } else s[k] = saved[k];
        });
        app.S.cur = cur; app.S.params = params;
        app.persist();
      }
      const ok = report.filter(x => x.kind === 'ok').length, bad = report.filter(x => x.kind === 'error').length;
      const secs = Math.round((Date.now() - t0) / 1000);
      app.switchTab('express');
      app.status.finish(bad ? 'warn' : 'ok', bad ? 'Montage express : ' + app.plural(bad, 'étape à revoir', 'étapes à revoir') : 'Ton montage est prêt · ' + r.name,
        app.plural(ok, 'étape réussie', 'étapes réussies') + ' en ' + (secs >= 60 ? Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s' : secs + ' s') + '. ↶ Annuler retire une étape à la fois.');
    }

    // ---------------------------------------------------------------- interface

    const thumbs = new Map();
    let showAll = false;
    function lookThumb(r) {
      const key = r.id + (r.id === 'mine' ? JSON.stringify(r.lookParams || {}) : '');
      // Bandeau 160 × 56 : le ciel et l'horizon du plan de test suffisent à montrer le look.
      const c = h('canvas', { width: 160, height: 56, class: 'xp-thumb' }), g = c.getContext('2d');
      if (thumbs.has(key)) { g.putImageData(thumbs.get(key), 0, 0); return c; }
      g.drawImage(Pv.shots().A, 0, -22, 160, 90);
      const p = lookParams(r);
      if (p) { const d = g.getImageData(0, 0, 160, 56); A.applyLut(d.data, D.buildLut(D.normalize(JSON.parse(JSON.stringify(p))), 9)); g.putImageData(d, 0, 0); }
      thumbs.set(key, g.getImageData(0, 0, 160, 56));
      return c;
    }

    let view = null;
    function render(v) {
      if (v) view = v;
      if (!view || !view.isConnected || app.S.tab !== 'express') return;
      const x = st(), r = recipe(), c = check;
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'xp-hero' }, h('div', { class: 'xp-hero-title' }, 'Ton montage en un clic'),
        h('div', { class: 'xp-hero-text' }, 'Choisis un style, RR FX enchaîne ce qu\'il faut : silences coupés, montage sur le rythme, couleur, transitions et sons, sous-titres, bandeau, version 9:16. Chaque outil reste dispo à part.')));

      // 1. Style
      // Six styles affichés (le choisi toujours compris), les autres d'un clic.
      const every = userRecipes().concat(R.RECIPES, [R.fromSettings(app.settings())]);
      let shownStyles = every;
      if (!showAll && every.length > 8) {
        shownStyles = every.slice(0, 6);
        const cur = every.find(rc => rc.id === x.recipe);
        if (cur && shownStyles.indexOf(cur) < 0) shownStyles.push(cur);
      }
      const cards = h('div', { class: 'xp-styles' }, shownStyles.map(rc => {
        const card = h('button', { class: 'xp-style' + (rc.id === x.recipe ? ' on' : ''), title: rc.desc }, lookThumb(rc), h('b', null, rc.name), h('span', { class: 'xp-sub' }, rc.chain.slice(0, 4).map(nameOf).join(' · ') || 'Aucun effet'));
        card.addEventListener('click', () => { x.recipe = rc.id; app.persist(); render(); app.renderCTA(); });
        return card;
      }));
      // Enregistrer le style choisi (avec ses étapes cochées) : réutilisable et partageable.
      const saveStyle = h('button', { class: 'action', title: 'Le style choisi et ses étapes cochées, dans Mes effets (exportable, partageable)' }, 'Enregistrer ce style…');
      saveStyle.addEventListener('click', async () => {
        const name = await app.promptName('Nom du style', r.name.replace(/^★ /, '') + ' perso');
        if (!name) return;
        const data = JSON.parse(JSON.stringify(Object.assign({}, r, { id: undefined, name, lookParams: lookParams(r) })));
        data.steps = {};
        R.stepsOf(r).forEach(q => { data.steps[q.id] = wants(r, q); });
        app.services.addItems([{ type: 'xpStyle', name, data: { recipe: data } }]);
        const it = app.S.lib.items.filter(i => i.type === 'xpStyle' && i.name === name).pop();
        if (it) x.recipe = 'u:' + it.id;
        app.persist(); render(); app.renderCTA();
        app.status.finish('ok', 'Style « ' + name + ' » enregistré', 'En tête des styles, et dans Mes effets pour l\'exporter ou le partager.');
      });
      const more = every.length > 8 ? h('button', { class: 'action quiet xp-more', 'aria-expanded': String(showAll) }, showAll ? 'Moins de styles' : 'Tous les styles (' + every.length + ')') : null;
      if (more) more.addEventListener('click', () => { showAll = !showAll; render(); });
      view.appendChild(section('1. Style', [cards, h('div', { class: 'row-buttons' }, more), h('div', { class: 'note' }, r.desc + (r.look ? ' Look ' + r.look + '.' : '')), h('div', { class: 'row-buttons' }, saveStyle)]));

      // 2. Vérifications, selon les étapes de ce style
      const all = R.stepsOf(r), has = id => all.some(q => q.id === id && wants(r, q));
      const music = all.some(q => wants(r, q) && R.needsMusic(q.id, r));
      const items = c ? [
        [c.sequence, 'Séquence ouverte', 'Ouvre ta séquence dans Premiere'],
        [c.adj, 'Calque de réglage dans le projet', 'Fichier > Nouveau > Calque de réglage (une fois par projet)'],
        music ? [!!c.music, c.music ? 'Musique : ' + c.music : 'Musique dans la séquence', 'Pose ta musique sur une piste audio'] : null,
        has('silences') ? [c.speech > 0, c.speech ? app.plural(c.speech, 'plan parlé sélectionné', 'plans parlés sélectionnés') : 'Plans où l\'on parle sélectionnés', 'Sélectionne-les dans la timeline (sinon la coupe des silences est passée)', true] : null,
        has('montage') ? [c.rushes > 0, c.rushes ? app.plural(c.rushes, 'rush sélectionné', 'rushs sélectionnés') + ' dans Projet' : 'Rushs sélectionnés dans le panneau Projet', 'Pour le montage auto (sinon, il est passé)', true] : null,
        has('convert') ? [c.cams > 0, c.cams ? app.plural(c.cams, 'caméra enregistrée', 'caméras enregistrées') : 'Caméra enregistrée', 'Pour la conversion LOG (onglet Couleur)', true] : null,
        has('titles') ? [c.lyrics > 0 && c.mogrt, c.lyrics ? app.plural(c.lyrics, 'ligne de paroles', 'lignes de paroles') : 'Paroles', 'Pour les paroles animées (onglet Textes)', true] : null,
        has('captions') ? [c.captions > 0 && c.mogrt, c.captions ? app.plural(c.captions, 'sous-titre', 'sous-titres') : 'Sous-titres (.srt)', 'Importe ton .srt dans l\'onglet Parole', true] : null,
        has('lower') ? [c.lower && c.mogrt, c.lower ? 'Bandeau prêt' : 'Bandeau nom et fonction', 'Écris le nom dans l\'onglet Parole', true] : null
      ].filter(Boolean) : [];
      const refresh = h('button', { class: 'action quiet', title: 'Revérifier' }, '↻ Vérifier');
      refresh.addEventListener('click', async () => { refresh.disabled = true; await verify(); render(); });
      view.appendChild(section('2. Avant de lancer', c ? items.map(([ok, label, hint, optional]) => h('div', { class: 'xp-check' + (ok ? ' ok' : optional ? ' opt' : ' ko') },
        h('span', { class: 'xp-dot' }, ok ? '✓' : optional ? '–' : '✕'), h('div', null, h('div', null, label), ok ? null : h('div', { class: 'note' }, hint))))
        : h('div', { class: 'note' }, 'Vérification…'), refresh));

      // 3. Étapes de ce style
      const list = all.map(step => {
        const why = blocker(step.id, c, r), sub = step.id === 'sfx';
        let desc = step.desc;
        if (step.id === 'effects') desc += r.place === 'allcuts' ? ' sur toutes les coupes de la séquence' : ' sur les temps forts';
        if (step.id === 'format' && r.format) desc = 'Copie ' + r.format.id.replace('x', ':') + (r.format.mode === 'blur' ? ' sur fond flou' : ' recadrée automatiquement');
        if (step.id === 'sfx' && r.sfx === 'none') desc += ' (aucun dans ce style)';
        const box = checkbox(step.label, wants(r, step) && !why, val => { picks(r)[step.id] = val; app.persist(); });
        return h('div', { class: 'xp-step' + (why ? ' off' : '') + (sub ? ' sub' : '') }, box, h('div', { class: 'note' }, why || desc));
      });
      view.appendChild(section('3. Étapes', list));

      if (report.length) {
        view.appendChild(section('Dernier montage express', report.map(it => h('div', { class: 'xp-check ' + (it.kind === 'ok' ? 'ok' : it.kind === 'error' ? 'ko' : 'opt') },
          h('span', { class: 'xp-dot' }, it.kind === 'ok' ? '✓' : it.kind === 'error' ? '✕' : '!'),
          h('div', null, h('div', null, it.label + ' · ' + (it.title || '')), it.detail ? h('div', { class: 'note' }, it.detail) : null)))));
      }
      if (!c) verify().then(() => render());
    }

    app.tabs.express = {
      render,
      cta: () => ({ label: 'Lancer · ' + recipe().name, run: launch, enabled: true }),
      leave: () => {}
    };
    app.actions.express = launch;
    app.itemTypes.xpStyle = {
      icon: '⚡', label: 'Style Express', valid: d => !!d.recipe && Array.isArray(d.recipe.chain) && !!d.recipe.beats && !!d.recipe.cut,
      meta: it => app.plural(it.data.recipe.chain.length, 'effet') + ' · ' + app.plural(Object.keys(it.data.recipe.steps || {}).length, 'étape'),
      open: it => { st().recipe = 'u:' + it.id; app.persist(); app.switchTab('express'); }
    };
  });
})(typeof self !== 'undefined' ? self : this);
