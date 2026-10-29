/* RR FX : les outils de Premiere, pilotés en un clic (onglet Montage > Premiere).
   - Transitions de Premiere (fondu enchaîné, fondu au noir, Morph Cut…) et fondus audio sur
     toutes les coupes ou celles de la sélection : de vraies transitions Premiere, modifiables
     ensuite comme si tu les avais posées à la main. Annulables.
   - Détection des changements de plan de Premiere : des coupes ou des marqueurs.
   - Sous-titres de Premiere : le .srt de l'onglet Parole (corrigé, traduit, recalé) devient une
     piste de sous-titres native.
   Ce que Premiere ne laisse pas piloter par un plugin (Remix, montage par le texte, amélioration
   de la voix) est indiqué, avec l'outil RR FX qui fait l'équivalent. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Host, Store } = app;
    const { h, hotText, row, picker, actionGroup, checkbox } = app.UI;
    const Tr = root.RRFXTraduction;

    const st = () => {
      const s = app.settings();
      if (!s.natifs || typeof s.natifs !== 'object') s.natifs = {};
      const d = { video: 'dissolve', audio: 'power', frames: 12, scope: 'sequence', align: 0.5, sceneAction: 'markers', sceneSens: 'medium', sceneAudio: true };
      Object.keys(d).forEach(k => { if (!(k in s.natifs)) s.natifs[k] = d[k]; });
      return s.natifs;
    };
    const VIDEO = () => [
      { v: '', label: _T('Aucune (son seulement)') },
      { v: 'dissolve', label: _T('Fondu enchaîné') },
      { v: 'film', label: _T('Fondu enchaîné (film)') },
      { v: 'additive', label: _T('Fondu enchaîné additif') },
      { v: 'black', label: _T('Fondu au noir') },
      { v: 'white', label: _T('Fondu au blanc') },
      { v: 'morph', label: _T('Morph Cut (lisse un jump cut d\'interview)') }
    ];
    const AUDIO = () => [
      { v: '', label: _T('Aucun') },
      { v: 'power', label: _T('Puissance constante (recommandé)') },
      { v: 'gain', label: _T('Gain constant') },
      { v: 'exp', label: _T('Fondu exponentiel') }
    ];

    // ---------------------------------------------------------------- transitions sur les coupes

    function transitions(over) {
      const x = Object.assign({}, st(), over || {});
      const name = (VIDEO().find(v => v.v === x.video) || {}).label || _T('Fondus audio');
      return app.runTask(_T('Transitions de Premiere'), async () => {
        if (!x.video && !x.audio) return { kind: 'warn', title: _T('Rien à poser'), detail: _T('Choisis une transition vidéo, un fondu audio, ou les deux.') };
        const r = await Host.call('nativeTransitions', { video: x.video, audio: x.audio, frames: x.frames, scope: x.scope, align: x.align });
        if (!r.ok) return { kind: 'error', title: _T('Transitions non posées'), detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        if (r.created.length) app.pushHistory({ date: Date.now(), label: (x.video ? name : _T('Fondus audio')) + ' × ' + (r.video || r.audio), entries: r.created });
        const parts = [];
        if (r.video) parts.push(app.plural(r.video, _T('transition'), _T('transitions')) + ' ' + name.toLowerCase().replace(/ \(.*\)$/, ''));
        if (r.audio) parts.push(app.plural(r.audio, _T('fondu audio'), _T('fondus audio')));
        return { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', title: parts.join(' + '), saved: r.created.length,
          detail: x.frames + _T(' images, sur ') + app.plural(r.cuts, _T('coupe')) + _T('. Ce sont des transitions de Premiere : retouche-les dans Options d\'effet. ↶ Annuler les retire.') + (x.video === 'morph' ? _T(' Morph Cut s\'analyse en arrière-plan dans Premiere.') : '') };
      });
    }
    // Après une coupe des silences : un fondu audio de 2 images sur chaque coupe enlève les clics.
    const audioFades = () => transitions({ video: '', audio: 'power', frames: 2, scope: 'sequence', align: 0.5 });

    // ---------------------------------------------------------------- changements de plan

    function sceneEdits() {
      const x = st();
      return app.runTask(_T('Changements de plan'), async () => {
        const r = await Host.call('sceneEdits', { action: x.sceneAction, sensitivity: x.sceneSens, audio: x.sceneAudio });
        if (!r.ok) return { kind: 'error', title: _T('Détection impossible'), detail: r.error };
        const markers = r.action === 'markers';
        if (!r.found) return { kind: 'ok', title: _T('Aucun changement de plan trouvé'), detail: _T('Essaie une sensibilité plus forte.') };
        return { kind: 'ok', title: markers ? app.plural(r.found, _T('marqueur posé'), _T('marqueurs posés')) : app.plural(r.found, _T('coupe faite'), _T('coupes faites')), saved: r.found,
          detail: (markers ? _T('Un marqueur à chaque changement de plan.') : _T('Le plan est coupé à chaque changement de plan.')) + _T(' Détection de Premiere. Ctrl+Z dans Premiere pour revenir en arrière.') };
      });
    }

    // ---------------------------------------------------------------- sous-titres de Premiere

    function nativeCaptions() {
      return app.runTask(_T('Sous-titres de Premiere'), async () => {
        if (!app.speech || !app.speech.cues().length) return { kind: 'warn', title: _T('Pas de sous-titres'), detail: _T('Importe ou colle d\'abord un .srt (Parole > Sous-titres).') };
        const cues = await app.speech.timedCues();
        let path = '/demo/' + _T('Sous-titres') + '.srt';
        if (Store.fs) {
          const dir = Store.path.join(Store.dir, _T('Sous-titres'));
          Store.fs.mkdirSync(dir, { recursive: true });
          const ctx = app.S.ctx || {}, d = new Date();
          path = Store.path.join(dir, String(ctx.name || _T('Sous-titres')).replace(/[\\/:*?"<>|]/g, '-') + ' ' + d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0') + '.srt');
          Store.fs.writeFileSync(path, Tr.toSrt(cues), 'utf8');
        }
        const r = await Host.call('nativeCaptions', { path, start: 0 });
        if (!r.ok) return { kind: 'error', title: _T('Piste non créée'), detail: r.error };
        return { kind: 'ok', title: _T('Piste de sous-titres créée'), saved: cues.length,
          detail: app.plural(cues.length, _T('sous-titre')) + _T(', à leur place dans la séquence. Style et retouches : panneau Texte de Premiere (Fenêtre > Texte). Le .srt est dans le chutier « RR FX/Sous-titres ».') };
      });
    }

    // ---------------------------------------------------------------- onglet

    app.extras.native = app.extras.native || [];
    app.extras.native.push({
      id: 'transitions', title: _T('Transitions de Premiere sur les coupes'), nav: _T('Transitions'),
      render: () => {
        const x = st();
        const go = h('button', { class: 'action go' }, _T('Poser les transitions'));
        go.addEventListener('click', () => transitions());
        const fades = h('button', { class: 'action', title: _T('Puissance constante, 2 images, sur toutes les coupes : le son ne claque plus après une coupe des silences') }, _T('Fondus audio anti-clic'));
        fades.addEventListener('click', audioFades);
        return [
          h('div', { class: 'note' }, _T('Les vraies transitions de Premiere, posées d\'un coup sur toutes les coupes (ou celles de la sélection) : modifiables ensuite dans Options d\'effet, comme si tu les avais posées à la main.')),
          row(_T('Vidéo'), picker(VIDEO(), x.video, v => { x.video = v; app.persist(); })),
          row(_T('Son'), picker(AUDIO(), x.audio, v => { x.audio = v; app.persist(); })),
          row(_T('Durée'), hotText({ value: x.frames, min: 1, max: 100, step: 1, unit: 'i', onChange: v => { x.frames = v; app.persist(); } })),
          row(_T('Où'), actionGroup([{ v: 'sequence', label: _T('Toutes les coupes') }, { v: 'selection', label: _T('La sélection') }], x.scope, v => { x.scope = v; app.persist(); })),
          row(_T('Position'), actionGroup([{ v: 1, label: _T('Avant') }, { v: 0.5, label: _T('Centrée') }, { v: 0, label: _T('Après') }], x.align, v => { x.align = v; app.persist(); })),
          h('div', { class: 'row-buttons wrap' }, go, fades),
          h('div', { class: 'note' }, _T('Fondus audio anti-clic : après une coupe des silences ou des « euh », 2 images de fondu sur chaque coupe et le son ne claque plus.'))
        ];
      }
    });
    app.extras.native.push({
      id: 'scenes', title: _T('Changements de plan (détection de Premiere)'), nav: _T('Plans'),
      render: () => {
        const x = st();
        const go = h('button', { class: 'action go' }, _T('Détecter sur la sélection'));
        go.addEventListener('click', sceneEdits);
        return [
          h('div', { class: 'note' }, _T('Une vidéo déjà montée (un rendu, un ancien montage, une pub) en un seul plan ? Premiere trouve chaque changement de plan : il le coupe, ou pose un marqueur.')),
          row(_T('Résultat'), actionGroup([{ v: 'markers', label: _T('Marqueurs') }, { v: 'cuts', label: _T('Coupes') }], x.sceneAction, v => { x.sceneAction = v; app.persist(); })),
          row(_T('Sensibilité'), actionGroup([{ v: 'low', label: _T('Faible') }, { v: 'medium', label: _T('Moyenne') }, { v: 'high', label: _T('Forte') }], x.sceneSens, v => { x.sceneSens = v; app.persist(); })),
          checkbox(_T('Couper aussi le son lié'), x.sceneAudio, v => { x.sceneAudio = v; app.persist(); }),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });
    app.extras.native.push({
      id: 'captions', title: _T('Sous-titres de Premiere'), nav: _T('Sous-titres'),
      render: () => {
        const go = h('button', { class: 'action go' }, _T('Créer la piste de sous-titres'));
        go.addEventListener('click', nativeCaptions);
        const n = app.speech ? app.speech.cues().length : 0;
        return [
          h('div', { class: 'note' }, _T('Ton .srt de l\'onglet Parole (corrigé, traduit, recalé sur tes coupes) devient une piste de sous-titres de Premiere : styles et retouches dans le panneau Texte de Premiere, export en sous-titres intégrés ou en fichier.')),
          h('div', { class: 'note' }, n ? app.plural(n, _T('sous-titre prêt'), _T('sous-titres prêts')) + '.' : _T('Aucun sous-titre : importe ou colle un .srt dans Parole > Sous-titres.')),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });
    app.extras.native.push({
      id: 'autres', title: _T('Les autres outils de Premiere'), nav: _T('Autres'), shut: true,
      render: () => {
        const link = (label, tab, sel) => { const b = h('button', { class: 'action quiet' }, label); b.addEventListener('click', () => app.services.reveal ? app.services.reveal(tab, sel) : app.switchTab(tab)); return b; };
        return [
          h('div', { class: 'note' }, _T('Recadrage automatique (Auto Reframe) : RR FX s\'en sert pour tes copies 9:16, 4:5 et 1:1.')),
          h('div', { class: 'row-buttons wrap' }, link(_T('Formats › Cadrage'), 'formats', '[data-sec=cadrage]')),
          h('div', { class: 'note' }, _T('Remix, montage basé sur le texte et amélioration de la voix de Premiere ne se pilotent pas depuis un plugin. RR FX fait l\'équivalent, en un clic et sur tous les plans :')),
          h('div', { class: 'row-buttons wrap' },
            link(_T('Musique à la durée'), 'music', '[data-sec=duree]'),
            link(_T('Montage par le texte'), 'speech', '[data-sec=texte]'),
            link(_T('Égaliser la voix'), 'speech', '[data-sec=voix]'))
        ];
      }
    });

    app.tabs.native = {
      render: view => {
        view.innerHTML = '';
        view.appendChild(h('div', { class: 'xp-hero' },
          h('div', { class: 'xp-hero-title' }, _T('Les outils de Premiere, en un clic')),
          h('div', { class: 'xp-hero-text' }, _T('Transitions et fondus audio sur toutes les coupes, détection des changements de plan, piste de sous-titres : ce sont les outils de Premiere, que RR FX pose pour toi partout d\'un coup.'))));
        app.renderExtras('native', view);
      },
      cta: () => ({ label: _T('Poser les transitions de Premiere'), run: () => transitions(), enabled: true })
    };
    app.actions.nativeTransitions = () => transitions();
    app.actions.audioFades = audioFades;
    app.actions.sceneEdits = sceneEdits;
    app.actions.nativeCaptions = nativeCaptions;
  });
})(typeof self !== 'undefined' ? self : this);
