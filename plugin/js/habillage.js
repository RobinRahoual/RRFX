/* RR FX : habillage.
   - Plans de coupe sur les mots clés (onglet Parole) : quand un mot du .srt se retrouve dans le
     nom d'une vidéo ou d'une image de tes dossiers liés (onglet Ressources), elle apparaît
     au-dessus de la personne, au moment où le mot est dit.
   - Barre de progression (onglet Textes) : une barre qui avance du début à la fin de la vidéo,
     en haut ou en bas, à ta couleur (une image animée par Trajectoire, modifiable ensuite).
   - Compte à rebours (onglet Textes) : 3, 5 ou 10 chiffres d'une seconde, avec ton style de
     texte, à la tête de lecture ou pour finir pile à la fin de la séquence. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Mo = root.RRFXMontage, C = root.RRFXCouleurs, { Host, Store, Core } = app;
    const { h, hotText, actionGroup, picker, row, checkbox } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.habillage || typeof s.habillage !== 'object') s.habillage = {};
      const d = { brDur: 2.5, brGap: 4, brMax: 20, barPos: 'bottom', barSize: 12, barColor: '#ffd21e', barBack: true, cdCount: 3, cdWhere: 'playhead', cdStyle: 'b:reels' };
      Object.keys(d).forEach(k => { if (!(k in s.habillage)) s.habillage[k] = d[k]; });
      return s.habillage;
    };
    const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    const TICKS = 254016000000;

    // Image PNG fabriquée dans le panneau → fichier dans Documents/RRFX/Images (ou nom en démo).
    function savePng(canvas, name) {
      if (!Store.fs) return name + '.png';
      const dir = Store.path.join(Store.dir, 'Images'), file = Store.path.join(dir, name + '.png');
      Store.fs.mkdirSync(dir, { recursive: true });
      Store.fs.writeFileSync(file, Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64'));
      return file;
    }
    const frame = () => ({ W: (app.S.ctx && app.S.ctx.frameW) || 1920, H: (app.S.ctx && app.S.ctx.frameH) || 1080 });
    async function seqEnd() {
      const r = await Host.call('listSequences', {});
      const q = r.ok ? r.sequences.find(x => x.id === r.active) : null;
      return q ? q.end : 0;
    }

    // ---------------------------------------------------------------- plans de coupe

    function brollFind() {
      const x = st(), media = app.services.resourceMedia ? app.services.resourceMedia() : [], cues = app.speech.cues();
      return { media, cues, plan: Mo.brollPlan(cues, media, { dur: x.brDur, gap: x.brGap, max: x.brMax }) };
    }

    function broll() {
      return app.runTask(_T('Plans de coupe'), async () => {
        const f = brollFind();
        if (!f.cues.length) return { kind: 'error', title: _T('Pas de sous-titres'), detail: _T('Il faut un .srt (section Sous-titres) : c\'est lui qui dit quand chaque mot est prononcé.') };
        if (!f.media.length) return { kind: 'error', title: _T('Aucune vidéo ni image liée'), detail: _T('Lie le dossier de tes plans de coupe (onglet Ressources) : les noms de fichiers servent de mots clés (« cafe_terrasse.mp4 »).') };
        if (!f.plan.length) return { kind: 'warn', title: _T('Aucun mot ne correspond'), detail: _T('Aucun mot des sous-titres ne se retrouve dans le nom de tes fichiers (4 lettres et plus).') };
        const t0 = await app.speech.startTime(app.speech.settings().capFrom).catch(() => 0), x = st(), created = [], warnings = [];
        for (let i = 0; i < f.plan.length; i++) {
          if (app.S.cancel) break;
          const p = f.plan[i], m = p.media;
          app.status.progress(i, f.plan.length, p.word + ' → ' + m.name);
          const r = await Host.call('placeAsset', { kind: m.type, path: m.path, name: m.name, times: [t0 + p.t], dur: p.dur, imageDur: x.brDur });
          if (r.ok) { created.push(...r.created); warnings.push(...(r.warnings || [])); } else warnings.push(m.name + ' : ' + r.error);
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: _T('Plans de coupe × ') + created.length, entries: created });
        warnings.forEach(w => app.log(w, 'warn'));
        return { kind: warnings.length ? 'warn' : 'ok', title: app.plural(created.length, _T('plan de coupe posé'), _T('plans de coupe posés')), detail: f.plan.slice(0, 4).map(p => _T('« ') + p.word + _T(' » ') + mmss(t0 + p.t)).join(', ') + (f.plan.length > 4 ? '…' : '') + _T('. Au-dessus des plans, image seule.') };
      }, true);
    }
    app.extras.speech.push({
      id: 'broll', title: _T('Plans de coupe sur les mots clés'), nav: _T('Plans de coupe'), tool: [_T('Poser les plans de coupe'), broll],
      render: use => {
        const x = st(), out = h('div', { class: 'note' }), go = h('button', { class: 'action go' }, _T('Poser les plans de coupe'));
        go.addEventListener('click', use('broll', broll));
        const look = h('button', { class: 'action' }, _T('Voir les correspondances'));
        look.addEventListener('click', () => {
          const f = brollFind();
          out.textContent = !f.media.length ? _T('Aucune vidéo ni image dans tes dossiers liés (onglet Ressources).') : !f.cues.length ? _T('Charge d\'abord un .srt.') : f.plan.length ? f.plan.map(p => mmss(p.t) + _T(' « ') + p.word + _T(' » → ') + p.media.name).join(' · ') : _T('Aucun mot des sous-titres ne correspond à un nom de fichier.');
        });
        return [
          h('div', { class: 'note' }, _T('Nomme tes plans de coupe avec ce qu\'ils montrent (« cafe_terrasse.mp4 », dossier « Voiture »…) et lie leur dossier (onglet Ressources) : quand le mot est dit dans le .srt, le plan apparaît au-dessus de la personne.')),
          row(_T('Durée'), hotText({ value: x.brDur, min: 0.5, max: 10, step: 0.5, unit: 's', onChange: v => { x.brDur = v; app.persist(); } })),
          row(_T('Écart min.'), hotText({ value: x.brGap, min: 1, max: 30, step: 1, unit: 's', onChange: v => { x.brGap = v; app.persist(); } })),
          row('Maximum', hotText({ value: x.brMax, min: 1, max: 100, step: 1, unit: '', onChange: v => { x.brMax = v; app.persist(); } })),
          h('div', { class: 'row-buttons' }, go, look), out
        ];
      }
    });

    // ---------------------------------------------------------------- barre de progression

    function progressBar() {
      const x = st();
      return app.runTask(_T('Barre de progression'), async () => {
        const end = await seqEnd();
        if (!(end > 1)) return { kind: 'error', title: _T('Séquence vide'), detail: _T('La barre va du début à la fin de la séquence.') };
        const { W, H } = frame(), cv = document.createElement('canvas'), size = Math.max(2, Math.round(x.barSize * H / 1080));
        cv.width = W; cv.height = H;
        const g = cv.getContext('2d'), y = x.barPos === 'top' ? 0 : H - size;
        g.fillStyle = x.barColor; g.fillRect(0, y, W, size);
        const bar = savePng(cv, 'RRFX barre ' + x.barColor.slice(1) + ' ' + x.barPos + ' ' + size + ' ' + W + 'x' + H);
        const created = [];
        if (x.barBack) {
          g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, y, W, size);
          const back = savePng(cv, 'RRFX barre fond ' + x.barPos + ' ' + size + ' ' + W + 'x' + H);
          const rb = await Host.call('placeStills', { items: [{ path: back, t: 0, dur: end }], name: 'RR FX · Barre (fond)', minTrack: 1 });
          if (rb.ok) created.push(...rb.created); else app.log(_T('Fond de la barre : ') + rb.error, 'warn');
        }
        const r = await Host.call('placeStills', { items: [{ path: bar, t: 0, dur: end }], name: 'RR FX · Barre de progression', minTrack: 1 });
        if (!r.ok) return { kind: 'error', title: _T('Barre non posée'), detail: r.error };
        created.push(...r.created);
        // La barre grandit depuis la gauche : largeur de 0 à 100 %, position qui suit.
        const fps = app.fps(), N = Math.max(2, Math.round(end * fps)), u = i => i / (N - 1);
        const fx = Core.toWire(Core.compileEffect({ sparse: true, params: [], build: () => [{ type: 'motion', props: { uniform: false, scale: 100, scaleW: i => 100 * u(i), position: i => [0.5 * u(i), 0.5] } }] }, {}, 'post', N, fps, app.registry()));
        const start = r.created[0].start, a = await Host.call('apply', { target: 'clip', name: 'RR FX · Barre de progression', targets: [{ side: 'post', clipTrack: r.track, clipStart: start, start, end: start + Math.round(end * TICKS), name: 'RR FX · Barre de progression', fx }] });
        if (!a.ok) app.log(_T('Animation de la barre : ') + a.error, 'warn');
        (a.warnings || []).forEach(w => app.log(w, 'warn'));
        app.pushHistory({ date: Date.now(), label: _T('Barre de progression'), entries: created });
        return { kind: a.ok ? 'ok' : 'warn', title: _T('Barre de progression posée'), detail: mmss(end) + _T(' de séquence, ') + (x.barPos === 'top' ? _T('en haut') : _T('en bas')) + ' (V' + (r.track + 1) + _T('). Couleur et épaisseur : refais-la ; vitesse : Options d\'effet > Trajectoire.') };
      });
    }

    // ---------------------------------------------------------------- compte à rebours

    function countdown() {
      const x = st();
      return app.runTask(_T('Compte à rebours'), async () => {
        const { W, H } = frame(), TS = app.textStyles, sty = (TS && TS.styleById(x.cdStyle)) || C.normStyle({ fill: '#ffffff', shadow: true });
        let t0;
        if (x.cdWhere === 'end') { const end = await seqEnd(); t0 = Math.max(0, end - x.cdCount); } else { const m = await Host.call('markerList', {}); t0 = m.ok ? m.playhead : 0; }
        const items = [];
        for (let n = x.cdCount; n >= 1; n--) {
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          const g = cv.getContext('2d');
          if (TS) TS.paint(g, String(n), Object.assign({}, sty, { size: 0 }), W / 2, H / 2, Math.round(H * 0.32));
          items.push({ path: savePng(cv, 'RRFX compte ' + n + ' ' + (x.cdStyle || 'blanc').replace(/[^a-z0-9]+/gi, '') + ' ' + W + 'x' + H), t: t0 + (x.cdCount - n), dur: 1 });
        }
        const r = await Host.call('placeStills', { items, name: 'RR FX · Compte à rebours', minTrack: 1 });
        if (!r.ok) return { kind: 'error', title: _T('Compte à rebours non posé'), detail: r.error };
        app.pushHistory({ date: Date.now(), label: _T('Compte à rebours'), entries: r.created });
        return { kind: 'ok', title: _T('Compte à rebours ') + x.cdCount + ' → 1', detail: _T('De ') + mmss(t0) + _T(' à ') + mmss(t0 + x.cdCount) + _T(', une image par seconde (V') + (r.track + 1) + ').' };
      });
    }

    app.extras.titles.push({
      id: 'barre', title: _T('Barre de progression et compte à rebours'), nav: _T('Barre'),
      render: () => {
        const x = st(), bar = h('button', { class: 'action go' }, _T('Poser la barre'));
        bar.addEventListener('click', progressBar);
        const cd = h('button', { class: 'action go' }, _T('Poser le compte à rebours'));
        cd.addEventListener('click', countdown);
        const color = app.services.colorPick ? app.services.colorPick(x.barColor, v => { x.barColor = v || '#ffd21e'; app.persist(); }) : h('span');
        const styles = app.textStyles ? app.textStyles.options().filter(o => o.v) : [{ v: '', label: _T('Blanc') }];
        return [
          h('div', { class: 'lr-sub' }, _T('Barre de progression')),
          h('div', { class: 'note' }, _T('Une barre qui avance du début à la fin de la vidéo : les gens voient combien il reste, ils restent jusqu\'au bout.')),
          row(_T('Où'), actionGroup([{ v: 'bottom', label: _T('En bas') }, { v: 'top', label: _T('En haut') }], x.barPos, v => { x.barPos = v; app.persist(); })),
          row(_T('Épaisseur'), hotText({ value: x.barSize, min: 2, max: 60, step: 1, unit: 'px', onChange: v => { x.barSize = v; app.persist(); } })),
          row(_T('Couleur'), color),
          checkbox(_T('Fond clair sous la barre'), x.barBack, v => { x.barBack = v; app.persist(); }),
          h('div', { class: 'row-buttons' }, bar),
          h('div', { class: 'lr-sub' }, _T('Compte à rebours')),
          row(_T('De'), actionGroup([{ v: 3, label: '3' }, { v: 5, label: '5' }, { v: 10, label: '10' }], x.cdCount, v => { x.cdCount = v; app.persist(); })),
          row(_T('Où'), actionGroup([{ v: 'playhead', label: _T('Tête de lecture') }, { v: 'end', label: _T('Finir à la fin') }], x.cdWhere, v => { x.cdWhere = v; app.persist(); })),
          row('Style', picker(styles, x.cdStyle, v => { x.cdStyle = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, cd)
        ];
      }
    });

    app.actions.broll = broll;
    app.actions.progressBar = progressBar;
    app.actions.countdown = countdown;
  });
})(typeof self !== 'undefined' ? self : this);
