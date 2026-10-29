/* RR FX : montage par le texte (onglet Parole). Le .srt s'affiche comme un texte : un clic sur
   une phrase amène la tête de lecture, ✕ la barre, et « Couper les phrases barrées » les retire
   de la timeline (même moteur que la coupe des silences). Les sous-titres restants sont recalés
   sur le nouveau montage. Une recherche trouve un mot dans tout le texte. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils, Sp = root.RRFXSpeech, Tr = root.RRFXTraduction, { Host } = app;
    const { h, checkbox } = app.UI;
    const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

    // Phrases barrées : liées au .srt chargé (un autre .srt les oublie).
    let struck = new Set(), forSrt = '', query = '';
    const cues = () => {
      const srt = app.speech.settings().srt;
      if (srt !== forSrt) { struck = new Set(); forSrt = srt; }
      return Sp.parseSubtitles(srt);
    };
    const st = () => {
      const x = app.speech.settings();
      if (!('textCopy' in x)) x.textCopy = true;
      return x;
    };

    function cutText(refresh) {
      const x = st(), list = cues(), picked = Array.from(struck).sort((p, q) => p - q);
      return app.runTask(_T('Montage par le texte'), async () => {
        if (!list.length) return { kind: 'error', title: _T('Pas de sous-titres'), detail: _T('Importe ou colle d\'abord un .srt (section Sous-titres).') };
        if (!picked.length) return { kind: 'warn', title: _T('Aucune phrase barrée'), detail: _T('Clique sur ✕ à côté des phrases à retirer.') };
        const t0 = await app.speech.startTime(x.capFrom);
        const ranges = O.textCuts(list, picked);
        app.status.phase(_T('Coupe et recollage'));
        const res = await Host.call('cutSilences', { ranges: ranges.map(r => ({ a: r.a + t0, b: r.b + t0 })), copy: !!x.textCopy, suffix: _T(' (montage texte)') });
        if (!res.ok) return { kind: 'error', title: _T('Phrases non coupées'), detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        // Le .srt suit le nouveau montage : les sous-titres se reposent au bon endroit.
        x.srt = Tr.toSrt(O.afterCuts(list, picked, ranges));
        forSrt = x.srt;
        struck = new Set();
        app.persist();
        if (refresh) refresh();
        return {
          kind: res.warnings && res.warnings.length ? 'warn' : 'ok', saved: picked.length * 3,
          title: app.plural(picked.length, _T('phrase coupée'), _T('phrases coupées')) + ' · ' + Math.round(res.seconds * 10) / 10 + _T(' s en moins'),
          detail: (res.copy ? _T('Dans « ') + res.name + _T(' » : ta séquence d\'origine est intacte.') : _T('Ctrl+Z (Cmd+Z) dans Premiere pour revenir en arrière.')) + _T(' Le .srt est recalé : « Poser les sous-titres » les met au bon endroit.')
        };
      }, true);
    }

    app.extras.speech.push({
      id: 'texte', title: _T('Montage par le texte'), nav: _T('Texte'), tool: [_T('Couper les phrases barrées'), () => cutText()],
      render: use => {
        const x = st(), box = h('div');
        const search = h('input', { class: 'textfield', type: 'search', value: query, placeholder: _T('Chercher un mot dans le texte…'), 'aria-label': _T('Chercher dans les sous-titres') });
        const list = h('div', { class: 'tx-list', role: 'list' }), info = h('div', { class: 'note' });
        const go = h('button', { class: 'action go' });
        const reset = h('button', { class: 'action quiet' }, _T('Tout rétablir'));
        let drawnFor = null;
        const draw = () => {
          const all = cues(), hits = new Set(O.findText(all, query));
          drawnFor = app.speech.settings().srt;
          list.innerHTML = '';
          if (!all.length) {
            list.appendChild(h('div', { class: 'note' }, _T('Charge un .srt (section Sous-titres) : son texte s\'affiche ici.')));
          }
          all.forEach((c, i) => {
            if (query && !hits.has(i)) return;
            const off = struck.has(i);
            const text = h('button', { class: 'tx-text', title: _T('Aller à ') + mmss(c.start) }, h('span', { class: 'tx-time' }, mmss(c.start)), ' ', c.text.replace(/\s*\n\s*/g, ' '));
            text.addEventListener('click', async () => {
              const t0 = await app.speech.startTime(x.capFrom).catch(() => 0);
              Host.call('setPlayhead', { t: t0 + c.start });
            });
            const cut = h('button', { class: 'action quiet icon tx-cut', title: off ? _T('Garder cette phrase') : _T('Barrer : à couper'), 'aria-pressed': off ? 'true' : 'false' }, off ? '↺' : '✕');
            cut.addEventListener('click', () => { if (off) struck.delete(i); else struck.add(i); draw(); });
            list.appendChild(h('div', { class: 'tx-row' + (off ? ' cut' : '') + (query && hits.has(i) ? ' hit' : ''), role: 'listitem' }, text, cut));
          });
          const n = struck.size, sec = O.textCuts(all, Array.from(struck)).reduce((s, r) => s + r.b - r.a, 0);
          go.textContent = n ? _T('Couper les phrases barrées (') + n + ')' : _T('Couper les phrases barrées');
          go.disabled = !n;
          reset.disabled = !n;
          info.textContent = query ? app.plural(hits.size, _T('phrase trouvée'), _T('phrases trouvées')) + (n ? ' · ' : '') + (n ? app.plural(n, _T('phrase barrée'), _T('phrases barrées')) + ', ' + Math.round(sec * 10) / 10 + _T(' s à couper') : '')
            : n ? app.plural(n, _T('phrase barrée'), _T('phrases barrées')) + ', ' + Math.round(sec * 10) / 10 + _T(' s à couper.') : all.length ? app.plural(all.length, _T('phrase')) + _T('. Clique sur une phrase pour y aller, ✕ pour la barrer.') : '';
        };
        search.addEventListener('input', () => { query = search.value; draw(); });
        go.addEventListener('click', use('texte', () => cutText(draw)));
        reset.addEventListener('click', () => { struck = new Set(); draw(); });
        draw();
        // Le .srt collé ou importé plus haut s'affiche aussitôt.
        const watch = setInterval(() => {
          if (!box.isConnected) { if (drawnFor !== null && !document.body.contains(box)) clearInterval(watch); return; }
          if (app.speech.settings().srt !== drawnFor) draw();
        }, 700);
        box.append(
          h('div', { class: 'note' }, _T('Ton .srt en texte : barre les phrases ratées, les redites ou les hors-sujet, et RR FX les coupe dans la timeline. Sélectionne d\'abord les plans où l\'on parle.')),
          search, list, info,
          checkbox(_T('Sur une copie de la séquence'), x.textCopy, v => { x.textCopy = v; app.persist(); }),
          h('div', { class: 'row-buttons' }, go, reset));
        return [box];
      }
    });
    app.actions.textCut = () => cutText();
  });
})(typeof self !== 'undefined' ? self : this);
