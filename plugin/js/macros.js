/* RR FX : macros. Plusieurs actions RR FX enchaînées (couper les silences, égaliser la voix,
   poser les sous-titres, vérifier…) lancées d'un seul bouton, d'une touche, de la recherche
   rapide ou d'un bouton de Stream Deck (télécommande). Une étape qui échoue arrête la macro. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Keys = root.RRFXShortcuts;
    const { h, picker, section } = app.UI;
    const PREFIX = 'macro:';
    // Pas d'étape qui ouvre une fenêtre ou en appelle une autre.
    const NOT_STEP = ['undo', 'history', 'palette', 'capture'];

    const list = () => {
      const s = app.settings();
      if (!Array.isArray(s.macros)) s.macros = [];
      return s.macros;
    };
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const stepsAvailable = () => Object.keys(Keys.ACTIONS).filter(id => id.indexOf(PREFIX) !== 0 && NOT_STEP.indexOf(id) < 0 && app.services.actionAvailable(id));
    const label = id => Keys.ACTIONS[id] || id;

    const EXAMPLES = [
      { name: _T('Interview prête'), steps: ['cutSilences', 'cutFillers', 'levelVoice', 'captions', 'preflight'] },
      { name: _T('Reels en un clic'), steps: ['express', 'formatCopy', 'progressBar'] }
    ];

    // Les macros deviennent des actions : raccourcis, télécommande, recherche rapide.
    function register() {
      Object.keys(Keys.ACTIONS).filter(id => id.indexOf(PREFIX) === 0).forEach(id => { delete Keys.ACTIONS[id]; delete app.actions[id]; });
      list().forEach(m => {
        Keys.ACTIONS[PREFIX + m.id] = '▶ ' + m.name;
        app.actions[PREFIX + m.id] = () => run(m.id);
      });
      // Touches enregistrées pour les macros (elles n'existaient pas encore au chargement).
      app.S.shortcuts = Keys.withDefaults(app.settings().shortcuts || app.S.shortcuts);
    }

    const idle = () => new Promise(resolve => { const t = setInterval(() => { if (!app.S.busy) { clearInterval(t); resolve(); } }, 120); });

    let running = false;
    async function run(id) {
      const m = list().find(q => q.id === id);
      if (!m || running || app.S.busy) return;
      running = true;
      const t0 = Date.now();
      let done = 0, failed = null;
      try {
        for (let i = 0; i < m.steps.length; i++) {
          const step = m.steps[i];
          if (!app.services.actionAvailable(step)) { app.log(_T('Macro « ') + m.name + _T(' » : étape indisponible, passée : ') + label(step), 'warn'); continue; }
          app.log(_T('Macro « ') + m.name + _T(' » · ') + (i + 1) + '/' + m.steps.length + ' · ' + label(step), 'info');
          let r = null;
          try { r = await app.services.runActionAsync(step); } catch (e) { r = { kind: 'error', detail: app.errorMessage(e) }; }
          await idle();
          if (r && r.kind === 'error') { failed = { step, detail: [r.title, r.detail].filter(Boolean).join(' · ') }; break; }
          if (app.S.cancel) { failed = { step, detail: _T('arrêtée') }; break; }
          done++;
        }
      } finally { running = false; }
      const secs = Math.round((Date.now() - t0) / 1000);
      if (failed) app.status.finish('error', _T('Macro « ') + m.name + _T(' » arrêtée'), _T('À l\'étape « ') + label(failed.step) + _T(' » : ') + failed.detail);
      else app.status.finish('ok', _T('Macro « ') + m.name + _T(' » terminée'), app.plural(done, _T('étape')) + _T(' en ') + secs + ' s : ' + m.steps.map(label).join(' → ') + '.');
    }

    // Fenêtre de création / modification.
    function edit(m) {
      const draft = { name: m ? m.name : '', steps: m ? m.steps.slice() : [] };
      const name = h('input', { class: 'textfield', value: draft.name, placeholder: _T('Nom de la macro (ex. Interview prête)'), 'aria-label': _T('Nom de la macro') });
      const steps = h('div', { class: 'macro-steps' });
      const options = stepsAvailable().map(v => ({ v, label: label(v) }));
      let pick = options.length ? options[0].v : '';
      const draw = () => {
        steps.innerHTML = '';
        if (!draft.steps.length) steps.appendChild(h('div', { class: 'note' }, _T('Ajoute les étapes dans l\'ordre où elles doivent se faire.')));
        draft.steps.forEach((s, i) => {
          const up = h('button', { class: 'action quiet icon', title: _T('Monter'), disabled: i === 0 }, '↑');
          up.addEventListener('click', () => { draft.steps.splice(i - 1, 0, draft.steps.splice(i, 1)[0]); draw(); });
          const del = h('button', { class: 'action quiet icon', title: _T('Retirer') }, '✕');
          del.addEventListener('click', () => { draft.steps.splice(i, 1); draw(); });
          steps.appendChild(h('div', { class: 'macro-step' }, h('span', { class: 'macro-num' }, String(i + 1)), h('span', { class: 'macro-label' }, label(s)), up, del));
        });
      };
      const add = h('button', { class: 'action' }, _T('＋ Ajouter'));
      add.addEventListener('click', () => { if (pick) { draft.steps.push(pick); draw(); } });
      draw();
      const body = h('div', null, name, steps, h('div', { class: 'row-buttons' }, picker(options, pick, v => { pick = v; }), add));
      return app.modal(m ? _T('Modifier la macro') : _T('Nouvelle macro'), body, [
        { label: _T('Annuler'), value: null },
        { label: _T('Enregistrer'), primary: true, value: () => ({ name: name.value.trim(), steps: draft.steps }) }
      ]).then(v => {
        if (!v) return;
        if (!v.name || !v.steps.length) { app.status.finish('warn', _T('Macro non enregistrée'), _T('Il faut un nom et au moins une étape.')); return; }
        if (m) Object.assign(m, v); else list().push(Object.assign({ id: uid() }, v));
        register();
        app.persist();
        app.switchTab('settings');
      });
    }

    function macrosSection() {
      const box = h('div'), all = list();
      if (!all.length) box.appendChild(h('div', { class: 'note' }, _T('Enchaîne plusieurs actions RR FX et lance-les d\'un clic, d\'une touche (Raccourcis clavier) ou d\'un bouton de Stream Deck (Télécommande). Exemples :')));
      all.forEach(m => {
        const go = h('button', { class: 'action go' }, _T('▶ Lancer'));
        go.addEventListener('click', () => run(m.id));
        const mod = h('button', { class: 'action quiet' }, _T('Modifier'));
        mod.addEventListener('click', () => edit(m));
        const del = h('button', { class: 'action quiet danger' }, _T('Supprimer'));
        del.addEventListener('click', async () => {
          if (!(await app.confirmDialog(_T('Supprimer la macro « ') + m.name + _T(' » ?'), _T('Sa touche et son adresse de télécommande ne marcheront plus.'), _T('Supprimer')))) return;
          list().splice(list().indexOf(m), 1);
          register();
          app.persist();
          app.switchTab('settings');
        });
        box.appendChild(h('div', { class: 'macro-item' },
          h('div', { class: 'macro-head' }, h('b', null, m.name), h('span', { class: 'note' }, app.plural(m.steps.length, _T('étape')))),
          h('div', { class: 'note macro-chain' }, m.steps.map(label).join(' → ')),
          h('div', { class: 'row-buttons' }, go, mod, del)));
      });
      const add = h('button', { class: 'action' + (all.length ? '' : ' go') }, _T('＋ Nouvelle macro'));
      add.addEventListener('click', () => edit(null));
      const row = [add];
      EXAMPLES.filter(e => !all.some(m => m.name === e.name)).forEach(e => {
        const b = h('button', { class: 'action quiet', title: e.steps.map(label).join(' → ') }, '＋ ' + e.name);
        b.addEventListener('click', () => { list().push({ id: uid(), name: e.name, steps: e.steps.filter(s => app.services.actionAvailable(s)) }); register(); app.persist(); app.switchTab('settings'); });
        row.push(b);
      });
      box.appendChild(h('div', { class: 'row-buttons wrap' }, row));
      const sec = section(_T('Macros'), [box], null, !all.length);
      sec.dataset.sec = 'macros';
      return sec;
    }

    app.settingsExtras.push(macrosSection);
    app.macros = { list, run, register };
    register();
  });
})(typeof self !== 'undefined' ? self : this);
