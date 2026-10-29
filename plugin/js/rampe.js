/* RR FX : onglet Rampe : speed ramps (courbe, préréglages, calage sur le tempo).
   Découpé de main.js : l'état et les services communs arrivent par « core ». */
(function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (window.RRFXPanels = window.RRFXPanels || []).push(function (core) {
    const Core = window.RRFXCore, Host = window.RRFXHost, Pv = window.RRFXPreview;
    const { Player, RampEditor, actionGroup, h, hotText, picker, row, section } = window.RRFXUI;
    const { $, status, RAMP_PLACEMENTS, S, app, clone, confirmDialog, fps, log, persist, plural, promptName,
      pushHistory, runTask, settings, uid } = core;

    // ---------------------------------------------------------------- onglet Speed ramp

    const ramp = () => settings().ramp;

    function rampPreviewFrames() {
      const R = ramp(), N = Math.max(2, R.frames), pieces = Core.rampPieces(R.points, N, R.segments);
      const before = R.placement === 'post' ? 0 : 10, after = R.placement === 'pre' ? 0 : 10;
      const speeds = [];
      for (let i = 0; i < before; i++) speeds.push(100);
      pieces.forEach(p => { for (let i = 0; i < p.frames; i++) speeds.push(p.speed); });
      for (let i = 0; i < after; i++) speeds.push(100);
      let tau = 0;
      return speeds.map(s => { const f = { tau, speed: s }; tau += s / 100; return f; });
    }

    function rampInfo() {
      const R = ramp(), pieces = Core.rampPieces(R.points, R.frames, R.segments), speeds = pieces.map(p => p.speed);
      return { src: Core.rampSourceFrames(pieces), min: Math.min.apply(null, speeds), max: Math.max.apply(null, speeds) };
    }

    function renderRampView() {
      const view = $('view-ramp');
      if (S.rampPlayer) { S.rampPlayer.stop(); S.rampPlayer = null; }
      view.innerHTML = '';
      const R = ramp();

      // Préréglages rangés par usage, puis tes rampes enregistrées ou importées.
      const presets = Object.keys(Core.RAMP_PRESETS).map(k => ({ key: k, label: Core.RAMP_PRESETS[k].label, data: Core.RAMP_PRESETS[k], group: Core.RAMP_PRESETS[k].placement }))
        .concat(S.lib.items.filter(i => i.type === 'ramp').map(i => ({ key: 'u:' + i.id, label: '★ ' + i.name, data: i.data, group: 'mine' })));
      const GROUPS = [['pre', _T('Avant la coupe')], ['post', _T('Après la coupe')], ['playhead', _T('Sur le temps fort')], ['full', _T('Plan entier')], ['mine', _T('Mes rampes')]];
      const chips = h('div', { class: 'ramp-groups' });
      GROUPS.forEach(([g, title]) => {
        const list = presets.filter(pr => pr.group === g);
        if (!list.length) return;
        const row_ = h('div', { class: 'chips' }, h('span', { class: 'chips-group' }, title));
        list.forEach(pr => {
          const b = h('button', { class: 'action' + (R.preset === pr.key ? ' selected' : '') }, pr.label);
          b.addEventListener('click', () => {
            R.points = clone(pr.data.points);
            if (pr.data.placement) R.placement = pr.data.placement;
            if (pr.data.frames) R.frames = pr.data.frames;
            if (pr.data.segments) R.segments = pr.data.segments;
            R.preset = pr.key;
            persist();
            renderRampView();
          });
          row_.appendChild(b);
        });
        chips.appendChild(row_);
      });
      const impRamp = h('button', { class: 'action', title: _T('Rampes reçues (.json, code de partage dans Mes effets)') }, _T('Importer des rampes…'));
      impRamp.addEventListener('click', () => core.importItems().then(() => renderRampView()));
      chips.appendChild(h('div', { class: 'row-buttons' }, impRamp));
      const saveBtn = h('button', { class: 'action quiet' }, _T('＋ Enregistrer'));
      saveBtn.addEventListener('click', saveRamp);
      view.appendChild(section(_T('Préréglages'), chips, saveBtn));

      const cv = h('canvas', { class: 'ramp-canvas' });
      const info = h('div', { class: 'ramp-info' });
      const refreshInfo = () => {
        const I = rampInfo();
        info.innerHTML = '';
        info.appendChild(h('span', null, _T('Vitesse '), h('b', null, Math.round(I.min) + '–' + Math.round(I.max) + ' %')));
        info.appendChild(h('span', null, _T('Média utilisé '), h('b', null, (Math.round(I.src * 10) / 10) + _T(' i')), _T(' pour ') + R.frames + _T(' i')));
      };
      view.appendChild(section(_T('Courbe de vitesse'), [cv, info, h('div', { class: 'note' }, _T('Glisse les points · double-clic pour ajouter ou supprimer · Alt+clic supprime.'))]));
      const changed = fin => {
        refreshInfo();
        if (S.rampEd) S.rampEd.draw();
        if (fin) { persist(); if (S.rampPlayer) S.rampPlayer.redraw(); }
      };
      S.rampEd = RampEditor(cv, {
        points: () => R.points,
        set: (pts, fin) => {
          R.points = pts;
          if (R.preset) { R.preset = null; chips.querySelectorAll('.action').forEach(c => c.classList.remove('selected')); }
          changed(fin);
        },
        frames: () => R.frames,
        segments: () => R.segments
      });
      refreshInfo();

      view.appendChild(section(_T('Réglages'), [
        row('Position', picker(RAMP_PLACEMENTS, R.placement, v => { R.placement = v; persist(); if (S.rampPlayer) S.rampPlayer.redraw(); })),
        row(_T('Durée'), hotText({ value: R.frames, min: 2, max: 600, step: 1, unit: 'i', onChange: (v, fin) => { R.frames = v; changed(fin); } })),
        row(_T('Sur le tempo'), actionGroup([0.5, 1, 2, 4].map(n => ({ v: n, label: n === 0.5 ? _T('½ temps') : n + _T(' temps') })), null, n => tempoRamp(n)), { title: _T('Durée de la rampe = un nombre de temps de la musique de la séquence') }),
        row(_T('Morceaux'), hotText({ value: R.segments, min: 2, max: 32, step: 1, unit: '', onChange: (v, fin) => { R.segments = v; changed(fin); } }), { title: _T('Plus de morceaux = rampe plus douce, mais plus de coupes dans la timeline') }),
        row(_T('Ancre'), picker([
          { v: 'auto', label: _T('Auto (coupe fixe)') },
          { v: 'end', label: _T('Garder l\'image de fin') },
          { v: 'start', label: _T('Garder l\'image de début') }
        ], R.anchor, v => { R.anchor = v; persist(); }), { title: _T('Quelle image reste à sa place. La durée dans la timeline ne change jamais.') }),
        row('Interpolation', picker([
          { v: 'keep', label: _T('Ne pas changer') },
          { v: 'blend', label: _T('Fusion d\'images') },
          { v: 'flow', label: _T('Flux optique') }
        ], R.interp, v => { R.interp = v; persist(); }))
      ]));

      const pcv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
      const pg = pcv.getContext('2d');
      let frames = rampPreviewFrames();
      S.rampPlayer = Player({ length: () => frames.length, fps: () => fps(), draw: n => { const f = frames[n]; if (f) Pv.drawRampScene(pg, f.tau, f.speed); } });
      const redraw = S.rampPlayer.redraw;
      S.rampPlayer.redraw = () => { frames = rampPreviewFrames(); redraw(); };
      view.appendChild(section(_T('Aperçu'), h('div', { class: 'pv-frame' }, pcv, h('span', { class: 'pv-label' }, _T('Aperçu simulé')))));
      view.appendChild(h('div', { class: 'note' }, _T('La rampe est posée sur une copie du passage, juste au-dessus du clip, en morceaux de vitesse constante (Premiere ne laisse pas les scripts piloter le remappage temporel). Le clip d\'origine, son son et la coupe ne bougent pas ; ↶ Annuler retire la copie.')));
      requestAnimationFrame(() => S.rampEd && S.rampEd.draw());
    }

    // Durée de la rampe calée sur le tempo de la musique (onglet Musique).
    function tempoRamp(beats) {
      return runTask('Tempo', async () => {
        if (!app.services.tempo) return { kind: 'error', title: _T('Musique indisponible'), detail: '' };
        status.phase(_T('Tempo de la musique'));
        const bpm = await app.services.tempo();
        if (!bpm) return { kind: 'warn', title: _T('Tempo introuvable'), detail: _T('La musique n\'a pas de pulsation régulière assez nette.') };
        const R = ramp();
        R.frames = Math.max(2, Math.round(beats * 60 / bpm * fps()));
        persist();
        renderRampView();
        return { kind: 'ok', title: _T('Rampe de ') + R.frames + _T(' images'), detail: (beats === 0.5 ? _T('½ temps') : plural(beats, _T('temps'), _T('temps'))) + _T(' à ~') + String(bpm).replace('.', ',') + ' BPM.' };
      });
    }

    async function saveRamp() {
      const R = ramp();
      const name = await promptName(_T('Enregistrer la rampe'), _T('Ma rampe'));
      if (!name) return;
      const item = { id: uid(), type: 'ramp', name, created: Date.now(), data: { points: clone(R.points), frames: R.frames, segments: R.segments, placement: R.placement } };
      S.lib.items.push(item);
      R.preset = 'u:' + item.id;
      persist();
      renderRampView();
      status.finish('ok', _T('Rampe enregistrée : ') + name, _T('Elle apparaît dans les préréglages.'));
    }

    async function applyRamp() {
      const R = ramp();
      if (S.busy) return;
      if (!(await confirmDialog(_T('Appliquer la rampe ?'), _T('Une copie du passage, découpée en ') + R.segments + _T(' morceaux à vitesses différentes, va être posée juste au-dessus du clip. Le clip d\'origine, son son et la coupe ne bougent pas. Le bouton ↶ Annuler la retire.'), _T('Appliquer'), 'confirmRamp'))) return;
      await runTask('Speed ramp', async () => {
        status.phase(_T('Analyse du clip'));
        const r = await Host.call('rampResolve', { placement: R.placement, frames: R.frames });
        if (!r.ok) return { kind: 'error', title: _T('Rampe non appliquée'), detail: r.error };
        status.phase(_T('Pose de la copie et des vitesses'));
        const pieces = Core.rampPieces(R.points, r.frames, R.segments);
        const anchor = R.anchor === 'auto' ? r.anchor : R.anchor;
        const res = await Host.call('rampApply', { track: r.track, clipStart: r.clipStart, clipName: r.clipName, regionStart: r.regionStart, pieces, anchor, interp: R.interp, copyLook: settings().copyLook });
        if (res.created && res.created.length) pushHistory({ date: Date.now(), label: _T('Rampe · ') + r.clipName, entries: res.created });
        if (!res.ok) {
          (res.warnings || []).forEach(w => log(w, 'warn'));
          return { kind: 'error', title: _T('Rampe non appliquée'), detail: res.error };
        }
        (res.warnings || []).forEach(w => log(w, 'warn'));
        log(_T('Rampe sur ') + r.clipName + ' : ' + res.pieces + _T(' morceaux, ') + (Math.round(res.sourceFrames * 10) / 10) + _T(' i de média'), 'ok');
        const bad = (res.warnings || []).some(w => /vérifier/.test(w));
        const notes = (res.warnings || []).length;
        return { kind: bad ? 'warn' : 'ok', title: _T('Rampe appliquée · ') + res.pieces + _T(' morceaux'), detail: _T('Copie de ') + r.clipName + _T(' sur V') + (res.track + 1) + (bad ? _T(' · certains morceaux sont à vérifier (journal)') : notes ? ' · ' + plural(notes, _T('remarque')) + _T(' dans le journal') : '') };
      });
    }

    Object.assign(core, { applyRamp, ramp, renderRampView });
  });
})();
