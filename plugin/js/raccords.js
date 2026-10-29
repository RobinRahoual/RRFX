/* RR FX : raccords et sous-titres propres (onglet Parole).
   - J-cut / L-cut : sur chaque coupe de la sélection, le son du plan suivant arrive avant son
     image (J) ou celui du plan précédent continue dessus (L). Annulable.
   - Coupes sur les blancs : chaque coupe de la sélection qui tombe au milieu d'un mot est
     déplacée de quelques images vers le blanc le plus proche (image et son ensemble).
   - Correcteur de sous-titres : lignes trop longues, lecture trop rapide, majuscules, espaces,
     ponctuation française ; « Tout corriger » répare ce qui peut l'être. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils, Sp = root.RRFXSpeech, Tr = root.RRFXTraduction, { Host } = app;
    const { h, hotText, row, actionGroup } = app.UI;
    const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

    const st = () => {
      const s = app.settings();
      if (!s.raccords || typeof s.raccords !== 'object') s.raccords = {};
      const d = { mode: 'j', frames: 12, window: 0.3 };
      Object.keys(d).forEach(k => { if (!(k in s.raccords)) s.raccords[k] = d[k]; });
      return s.raccords;
    };

    // ---------------------------------------------------------------- J-cut / L-cut

    function splitEdits(mode) {
      const x = st(), m = mode || x.mode;
      return app.runTask(m === 'l' ? 'L-cut' : 'J-cut', async () => {
        const r = await Host.call('splitEdits', { mode: m, frames: x.frames });
        if (!r.ok) return { kind: 'error', title: _T('Raccords non posés'), detail: r.error };
        if (r.created.length) app.pushHistory({ date: Date.now(), label: (m === 'l' ? 'L-cut' : 'J-cut') + ' × ' + r.done, entries: r.created });
        if (!r.done) return { kind: 'warn', title: _T('Aucun raccord posé'), detail: _T('Il faut des plans qui se suivent avec leur son, et un peu de média avant (J) ou après (L) chaque coupe.') };
        return {
          kind: r.passed ? 'warn' : 'ok', title: app.plural(r.done, m === 'l' ? 'L-cut' : 'J-cut') + ' · ' + x.frames + _T(' images'),
          detail: (m === 'l' ? _T('Le son de chaque plan continue sur le suivant.') : _T('Le son de chaque plan arrive avant son image.')) + (r.passed ? ' ' + app.plural(r.passed, _T('coupe passée'), _T('coupes passées')) + _T(' (pas de son lié ou pas assez de média).') : '') + _T(' ↶ Annuler remet les coupes droites.')
        };
      });
    }

    // ---------------------------------------------------------------- coupes sur les blancs

    async function sideEnergy(path, from, to, step) {
      if (app.S.demo || !path) {
        // Mode démo : la voix de démonstration, au même instant que le média.
        const sr = 8000, a = Math.max(0, from), d = Sp.demoSpeech(sr, to + 1), off = Math.round(a * sr);
        return { e: O.energy(d.subarray(off, off + Math.max(1, Math.round((to - a) * sr))), sr, step), start: a };
      }
      const a = await app.services.readAudio(path, Math.max(0, from), to);
      return { e: O.energy(a.samples, a.sampleRate, step), start: a.start };
    }

    function cleanCuts() {
      const x = st();
      return app.runTask(_T('Coupes sur les blancs'), async () => {
        const l = await Host.call('cutList', {});
        if (!l.ok) return { kind: 'error', title: _T('Pas de coupe'), detail: l.error };
        const step = 1 / (l.fps || 25), K = Math.round(x.window / step), moves = [];
        for (let i = 0; i < l.cuts.length; i++) {
          if (app.S.cancel) break;
          const c = l.cuts[i];
          app.status.progress(i, l.cuts.length, _T('Écoute de la coupe à ') + mmss(c.t));
          const A = await sideEnergy(c.a.path, c.a.out - x.window - step, c.a.out + x.window + step, step);
          const B = await sideEnergy(c.b.path, c.b.inP - x.window - step, c.b.inP + x.window + step, step);
          const costA = [], costB = [];
          for (let k = -K; k <= K; k++) {
            const d = k * step;
            // Au-delà du média disponible ou d'un plan trop court : impossible.
            const okA = d <= c.a.room + 1e-6 && -d < c.a.len - step, okB = -d <= c.b.room + 1e-6 && d < c.b.len - step;
            const ia = Math.round((c.a.out + d * c.a.speed - A.start) / step), ib = Math.round((c.b.inP + d * c.b.speed - B.start) / step);
            costA.push(okA && A.e[ia] !== undefined ? A.e[ia] : Infinity);
            costB.push(okB && B.e[ib] !== undefined ? B.e[ib] : Infinity);
          }
          const off = O.quietOffset(costA, costB, K);
          if (off) moves.push({ t: c.t, to: c.t + off * step });
        }
        if (!moves.length) return { kind: 'ok', title: _T('Coupes déjà propres'), detail: app.plural(l.cuts.length, _T('coupe écoutée'), _T('coupes écoutées')) + _T(' : aucune ne coupe un mot.') };
        const r = await Host.call('rollEdits', { moves });
        if (!r.ok) return { kind: 'error', title: _T('Coupes non déplacées'), detail: r.error };
        if (r.created.length) app.pushHistory({ date: Date.now(), label: _T('Coupes sur les blancs × ') + r.moved, entries: r.created });
        return { kind: 'ok', title: app.plural(r.moved, _T('coupe déplacée'), _T('coupes déplacées')) + _T(' sur un blanc'), detail: moves.slice(0, 4).map(m => mmss(m.t) + ' ' + (m.to > m.t ? '+' : '−') + Math.round(Math.abs(m.to - m.t) / step) + _T(' im.')).join(', ') + (moves.length > 4 ? '…' : '') + _T('. Image et son bougent ensemble. ↶ Annuler les remet.') };
      }, true);
    }

    app.extras.speech.push({
      id: 'raccords', title: _T('Raccords J-cut / L-cut et coupes propres'), nav: _T('Raccords'), tool: [_T('Poser les raccords'), () => splitEdits()],
      render: use => {
        const x = st();
        const go = h('button', { class: 'action go' }, _T('Poser les raccords'));
        go.addEventListener('click', use('raccords', () => splitEdits()));
        const clean = h('button', { class: 'action' }, _T('Recaler les coupes sur les blancs'));
        clean.addEventListener('click', cleanCuts);
        return [
          h('div', { class: 'note' }, _T('Sélectionne des plans qui se suivent (interview, documentaire). J-cut : on entend la phrase suivante avant de voir la personne. L-cut : la voix continue sur le plan suivant. Le raccord classique des interviews.')),
          row(_T('Raccord'), actionGroup([{ v: 'j', label: _T('J-cut (son avant)') }, { v: 'l', label: _T('L-cut (son après)') }], x.mode, v => { x.mode = v; app.persist(); })),
          row(_T('Décalage'), hotText({ value: x.frames, min: 2, max: 50, step: 1, unit: 'i', onChange: v => { x.frames = v; app.persist(); } })),
          h('div', { class: 'row-buttons' }, go),
          h('div', { class: 'note' }, _T('Coupes sur les blancs : chaque coupe de la sélection qui tombe au milieu d\'un mot est déplacée de quelques images vers le blanc le plus proche, des deux côtés.')),
          h('div', { class: 'row-buttons' }, clean)
        ];
      }
    });

    // ---------------------------------------------------------------- correcteur de sous-titres

    const KIND = () => ({
      long: _T('ligne trop longue'), fast: _T('lecture trop rapide'), short: _T('trop court'),
      caps: _T('majuscule manquante'), spaces: _T('espaces en trop'), punct: _T('espace avant « : ; ! ? »')
    });
    let lastIssues = null, checkedFor = '';
    function checkNow() {
      const sp = app.speech.settings(), cues = Sp.parseSubtitles(sp.srt);
      lastIssues = O.checkCues(cues, { lang: (root.RRFXI18n && root.RRFXI18n.lang) || 'fr' });
      checkedFor = sp.srt;
      app.settings().subsChecked = true;
      return { cues, issues: lastIssues };
    }
    function fixAll(refresh) {
      const sp = app.speech.settings(), cues = Sp.parseSubtitles(sp.srt);
      if (!cues.length) return app.status.finish('warn', _T('Pas de sous-titres'), _T('Importe ou colle d\'abord un .srt (section Sous-titres).'));
      const f = O.fixCues(cues, Tr.wrap, { lang: (root.RRFXI18n && root.RRFXI18n.lang) || 'fr' });
      sp.srt = Tr.toSrt(f.cues);
      app.persist();
      const left = checkNow().issues;
      if (refresh) refresh();
      app.status.finish(f.fixed ? 'ok' : 'idle', f.fixed ? app.plural(f.fixed, _T('sous-titre corrigé'), _T('sous-titres corrigés')) : _T('Rien à corriger'), left.length ? app.plural(left.length, _T('remarque restante'), _T('remarques restantes')) + _T(' (texte trop dense : à raccourcir à la main).') : _T('Les sous-titres sont propres. « Poser les sous-titres » pour les mettre à jour.'));
    }

    app.extras.speech.push({
      id: 'correcteur', title: _T('Correcteur de sous-titres'), nav: _T('Correcteur'),
      render: () => {
        const box = h('div'), list = h('div', { class: 'pf-list' });
        const draw = () => {
          list.innerHTML = '';
          if (!lastIssues) return;
          const cues = Sp.parseSubtitles(app.speech.settings().srt), K = KIND();
          if (!lastIssues.length) { list.appendChild(h('div', { class: 'note pf-ok' }, _T('✓ Aucun problème sur ') + app.plural(cues.length, _T('sous-titre')) + '.')); return; }
          lastIssues.slice(0, 60).forEach(p => {
            const c = cues[p.i];
            if (!c) return;
            const b = h('button', { class: 'pf-item ' + (p.kind === 'fast' || p.kind === 'long' ? 'error' : 'warn'), title: _T('Aller à ') + mmss(c.start) }, h('span', { class: 'pf-icon' }, '!'), h('span', { class: 'pf-time' }, '#' + (p.i + 1) + ' · ' + mmss(c.start)), h('span', { class: 'pf-text' }, K[p.kind] + ' : ' + c.text.replace(/\s*\n\s*/g, ' / ').slice(0, 60)));
            b.addEventListener('click', async () => { const t0 = await app.speech.startTime(app.speech.settings().capFrom).catch(() => 0); Host.call('setPlayhead', { t: t0 + c.start }); });
            list.appendChild(b);
          });
        };
        const check = h('button', { class: 'action' }, _T('Vérifier les sous-titres'));
        check.addEventListener('click', () => {
          const r = checkNow();
          draw();
          app.status.finish(r.issues.length ? 'warn' : 'ok', r.issues.length ? app.plural(r.issues.length, _T('remarque')) : _T('Sous-titres propres'), r.cues.length ? app.plural(r.cues.length, _T('sous-titre')) + _T(' vérifiés.') : _T('Charge d\'abord un .srt.'));
        });
        const fix = h('button', { class: 'action go' }, _T('Tout corriger'));
        fix.addEventListener('click', () => fixAll(draw));
        if (lastIssues && checkedFor !== app.speech.settings().srt) lastIssues = null;
        draw();
        box.append(h('div', { class: 'note' }, _T('Au plus 42 caractères par ligne et 2 lignes, 20 caractères par seconde, majuscule en début de phrase, espaces propres, espace insécable avant « : ; ! ? » en français. « Tout corriger » recoupe les lignes et allonge un sous-titre trop rapide dans le blanc qui suit.')), h('div', { class: 'row-buttons' }, fix, check), list);
        return [box];
      }
    });

    app.actions.splitEdits = () => splitEdits();
    app.actions.cleanCuts = () => cleanCuts();
  });
})(typeof self !== 'undefined' ? self : this);
