/* RR FX : onglet Express. Ton clip en un clic : choisis un style, RR FX enchaîne tout ce que
   le plugin sait faire (temps forts, montage sur le rythme, conversion LOG, expo, look, effets
   enchaînés, sons sur les coupes, paroles, copie 9:16). Chaque étape reste une opération
   séparée : ↶ Annuler en retire une à la fois, et tes réglages des autres onglets sont rendus
   tels quels à la fin. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const R = root.RRFXRecipes, D = root.RRFXDevelop, A = root.RRFXAssets, { Host, Pv } = app;
    const { h, section, checkbox } = app.UI;
    const DEFAULT_STEPS = { beats: true, montage: true, convert: true, fix: false, look: true, effects: true, sfx: true, titles: true, format: false };

    const st = () => {
      // Complète sans remplacer l'objet (l'interface garde une référence dessus).
      const s = app.settings();
      if (!s.express || typeof s.express !== 'object') s.express = {};
      if (!s.express.recipe) s.express.recipe = 'rap';
      if (!s.express.steps || typeof s.express.steps !== 'object') s.express.steps = {};
      Object.keys(DEFAULT_STEPS).forEach(k => { if (!(k in s.express.steps)) s.express.steps[k] = DEFAULT_STEPS[k]; });
      return s.express;
    };
    const recipe = () => (st().recipe === 'mine' ? R.fromSettings(app.settings()) : R.byId(st().recipe) || R.RECIPES[0]);
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
      out.mogrt = !!(s.titles && s.titles.mogrt);
      check = out;
      return out;
    }

    // Étape possible ? → '' si oui, sinon la raison.
    function blocker(id, c) {
      if (!c) return '';
      if (id === 'montage' && !c.rushes) return 'Sélectionne tes rushs dans le panneau Projet';
      if (id === 'convert' && !c.cams) return 'Ajoute ta caméra (onglet Couleur)';
      if (id === 'titles' && !c.lyrics) return 'Colle tes paroles (onglet Textes)';
      if (id === 'titles' && !c.mogrt) return 'Choisis un modèle de texte (onglet Textes)';
      return '';
    }

    // ---------------------------------------------------------------- étapes

    const EVERY = [1, 2, 4, 8];
    const nearest = v => EVERY.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

    async function runStep(id, r, c) {
      const s = app.settings(), steps = st().steps;
      switch (id) {
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
          Object.assign(s, { placement: 'markers', side: 'both', vary: 'chain', sfx: steps.sfx ? r.sfx : 'none' });
          s.chain = { keys: r.chain.slice(), order: r.order };
          app.S.cur = first;
          app.S.params = Object.assign(app.services.defaultParams(first), { frames: r.frames, intensity: r.intensity });
          return app.actions.applyEffect();
        }
        case 'titles':
          Object.assign(s.titles, { timing: 'markers', from: 'start', anim: r.title });
          return app.actions.titles();
        case 'format':
          Object.assign(s.formats, { id: '9x16', mode: 'reframe' });
          return app.actions.formatCopy();
      }
      return null;
    }

    // Réglages des autres onglets que l'Express change le temps d'une étape.
    const KEEP = ['placement', 'side', 'vary', 'chain', 'sfx', 'beats', 'autoEdit', 'titles', 'color', 'logconv', 'correction', 'formats'];

    let report = [];
    async function launch() {
      if (app.S.busy) return;
      const c = await verify();
      if (!c.sequence) return app.status.finish('error', 'Ouvre une séquence', 'Le clip express travaille sur la séquence active de Premiere.');
      if (!c.adj) return app.status.finish('error', 'Il manque un calque de réglage', 'Une fois par projet : Fichier > Nouveau > Calque de réglage. RR FX le retrouve tout seul.');
      if (!c.music) return app.status.finish('error', 'Pas de musique dans la séquence', 'Pose ta musique sur une piste audio : tout se cale dessus.');
      const r = recipe(), want = st().steps;
      const steps = R.STEPS.filter(x => x.id !== 'sfx' && want[x.id] && !blocker(x.id, c));
      if (!steps.length) return app.status.finish('warn', 'Aucune étape', 'Coche au moins une étape.');
      const s = app.settings(), saved = {}, cur = app.S.cur, params = app.S.params;
      KEEP.forEach(k => { if (k in s) saved[k] = JSON.parse(JSON.stringify(s[k])); });
      ['beats', 'autoEdit', 'titles', 'color', 'logconv', 'correction', 'formats'].forEach(k => { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
      if (!s.correction.fix) s.correction.fix = {};
      report = [];
      const t0 = Date.now();
      app.log('Clip express · ' + r.name + ' : ' + steps.map(x => x.label).join(' → '), 'info');
      try {
        for (const step of steps) {
          const res = await runStep(step.id, r, c);
          report.push({ id: step.id, label: step.label, kind: res ? res.kind : 'error', title: res ? res.title : 'Panneau occupé', detail: res ? res.detail || '' : '' });
          render();
          if (app.S.cancel) { report.push({ id: 'stop', label: 'Arrêté', kind: 'warn', title: 'Les étapes suivantes n\'ont pas été faites' }); break; }
          // Sans temps forts ni montage, la suite n'a pas de sens.
          if ((!res || res.kind === 'error') && (step.id === 'beats' || step.id === 'montage')) break;
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
      app.status.finish(bad ? 'warn' : 'ok', bad ? 'Clip express : ' + app.plural(bad, 'étape à revoir', 'étapes à revoir') : 'Ton clip est prêt · ' + r.name,
        app.plural(ok, 'étape réussie', 'étapes réussies') + ' en ' + (secs >= 60 ? Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s' : secs + ' s') + '. ↶ Annuler retire une étape à la fois.');
    }

    // ---------------------------------------------------------------- interface

    const thumbs = new Map();
    function lookThumb(r) {
      const key = r.id + (r.id === 'mine' ? JSON.stringify(r.lookParams || {}) : '');
      const c = h('canvas', { width: 160, height: 90, class: 'xp-thumb' }), g = c.getContext('2d');
      if (thumbs.has(key)) { g.putImageData(thumbs.get(key), 0, 0); return c; }
      g.drawImage(Pv.shots().A, 0, 0, 160, 90);
      const p = lookParams(r);
      if (p) { const d = g.getImageData(0, 0, 160, 90); A.applyLut(d.data, D.buildLut(D.normalize(JSON.parse(JSON.stringify(p))), 9)); g.putImageData(d, 0, 0); }
      thumbs.set(key, g.getImageData(0, 0, 160, 90));
      return c;
    }

    let view = null;
    function render(v) {
      if (v) view = v;
      if (!view || !view.isConnected || app.S.tab !== 'express') return;
      const x = st(), r = recipe(), c = check;
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'xp-hero' },
        h('div', { class: 'xp-hero-title' }, 'Ton clip en un clic'),
        h('div', { class: 'xp-hero-text' }, 'Choisis un style : RR FX pose les temps forts, monte tes rushs sur le rythme, convertit et étalonne, enchaîne les effets avec leurs sons et pose les paroles.')));

      // 1. Vérifications
      const items = c ? [
        [c.sequence, 'Séquence ouverte', 'Ouvre ta séquence dans Premiere'],
        [c.adj, 'Calque de réglage dans le projet', 'Fichier > Nouveau > Calque de réglage (une fois par projet)'],
        [!!c.music, c.music ? 'Musique : ' + c.music : 'Musique dans la séquence', 'Pose ta musique sur une piste audio'],
        [c.rushes > 0, c.rushes ? app.plural(c.rushes, 'rush sélectionné', 'rushs sélectionnés') + ' dans Projet' : 'Rushs sélectionnés dans le panneau Projet', 'Pour le montage auto (sinon, il est passé)', true],
        [c.cams > 0, c.cams ? app.plural(c.cams, 'caméra enregistrée', 'caméras enregistrées') : 'Caméra enregistrée', 'Pour la conversion LOG (onglet Couleur)', true],
        [c.lyrics > 0 && c.mogrt, c.lyrics ? app.plural(c.lyrics, 'ligne de paroles', 'lignes de paroles') : 'Paroles', 'Pour les paroles animées (onglet Textes)', true]
      ] : [];
      const refresh = h('button', { class: 'action quiet', title: 'Revérifier' }, '↻ Vérifier');
      refresh.addEventListener('click', async () => { refresh.disabled = true; await verify(); render(); });
      view.appendChild(section('1. Avant de lancer', c ? items.map(([ok, label, hint, optional]) => h('div', { class: 'xp-check' + (ok ? ' ok' : optional ? ' opt' : ' ko') },
        h('span', { class: 'xp-dot' }, ok ? '✓' : optional ? '–' : '✕'), h('div', null, h('div', null, label), ok ? null : h('div', { class: 'note' }, hint))))
        : h('div', { class: 'note' }, 'Vérification…'), refresh));

      // 2. Style
      const cards = h('div', { class: 'xp-styles' }, R.RECIPES.concat([R.fromSettings(app.settings())]).map(rc => {
        const card = h('button', { class: 'xp-style' + (rc.id === x.recipe ? ' on' : ''), title: rc.desc }, lookThumb(rc), h('b', null, rc.name), h('span', { class: 'xp-sub' }, rc.chain.slice(0, 4).map(nameOf).join(' · ') || 'Aucun effet'));
        card.addEventListener('click', () => { x.recipe = rc.id; app.persist(); render(); app.renderCTA(); });
        return card;
      }));
      view.appendChild(section('2. Style', [cards, h('div', { class: 'note' }, r.desc + (r.look ? ' Look ' + r.look + '.' : ''))]));

      // 3. Étapes
      const list = R.STEPS.map(step => {
        const why = blocker(step.id, c), sub = step.id === 'sfx';
        const box = checkbox(step.label, x.steps[step.id] && !why, v => { x.steps[step.id] = v; app.persist(); });
        return h('div', { class: 'xp-step' + (why ? ' off' : '') + (sub ? ' sub' : '') }, box, h('div', { class: 'note' }, why || step.desc + (step.id === 'sfx' && r.sfx === 'none' ? ' (aucun dans ce style)' : '')));
      });
      view.appendChild(section('3. Étapes', list));

      if (report.length) {
        view.appendChild(section('Dernier clip express', report.map(it => h('div', { class: 'xp-check ' + (it.kind === 'ok' ? 'ok' : it.kind === 'error' ? 'ko' : 'opt') },
          h('span', { class: 'xp-dot' }, it.kind === 'ok' ? '✓' : it.kind === 'error' ? '✕' : '!'),
          h('div', null, h('div', null, it.label + ' · ' + (it.title || '')), it.detail ? h('div', { class: 'note' }, it.detail) : null)))));
      }
      if (!c) verify().then(() => render());
    }

    app.tabs.express = {
      render,
      cta: () => ({ label: 'Lancer le clip express · ' + recipe().name, run: launch, enabled: true }),
      leave: () => {}
    };
    app.actions.express = launch;
  });
})(typeof self !== 'undefined' ? self : this);
