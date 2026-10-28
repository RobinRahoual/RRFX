/* CutFX — faux Premiere utilisé quand le panneau tourne hors de Premiere (mode démo). */
(function (root) {
  'use strict';
  const FPS = 25, TICKS = 254016000000, F = TICKS / FPS;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const EFFECTS = ['Transformer', 'Flou gaussien', 'Flou directionnel', 'Luminosité et contraste', 'Décalage',
    'Déformation de la vague', 'Distorsion de l’objectif', 'Écho', 'Lumetri Color', 'Flou de l’appareil photo'];

  function windows(a) {
    const cuts = a.placement === 'markers' ? [100, 150, 200, 250] : a.placement === 'cuts' ? [100, 175] : [300];
    const sides = a.placement === 'clipStart' ? ['post'] : a.placement === 'clipEnd' ? ['pre'] : a.placement === 'full' ? [a.sides[0]] : a.sides;
    const targets = [];
    cuts.forEach(c => sides.forEach(side => {
      const n = a.placement === 'full' ? 90 : a.frames;
      targets.push({ side, start: (side === 'pre' ? c - n : c) * F, end: (side === 'pre' ? c : c + n) * F, frames: n, track: 0, clipTrack: 0, clipStart: 0, clipName: 'A001_C004.mov' });
    }));
    return targets;
  }

  const handlers = {
    compat: () => ({ ok: true, version: root.CutFXHost ? root.CutFXHost.VERSION : '?', app: 'démo', missing: [], optional: [] }),
    getContext: () => ({
      ok: true, hasSequence: true, version: 'démo', app: 'démo', name: 'Clip — démo', fps: FPS, frameW: 1920, frameH: 1080,
      playhead: 12.4, selection: 2, selectionNames: ['A001_C004.mov', 'A001_C007.mov'], markers: 4,
      adj: { name: 'Calque de réglage', nodeId: 'demo' }
    }),
    resolve: a => ({ ok: true, fps: FPS, frameW: 1920, frameH: 1080, targets: windows(a), warnings: [] }),
    apply: async a => {
      await wait(a.targets.length * 120);
      return { ok: true, created: a.targets.map(t => ({ kind: a.target === 'clip' ? 'clip' : 'adj', track: 1, start: t.start, name: (t.name || a.name) + ' ' + t.side.toUpperCase(), added: [] })), props: 3, warnings: [] };
    },
    undo: a => ({ ok: true, removed: a.entries.filter(e => e.kind === 'adj').length, effects: 0, skipped: a.entries.filter(e => e.kind !== 'adj').length }),
    capture: () => ({
      ok: true, name: 'Mon zoom perso', frames: 10, fps: FPS, frameW: 1920, frameH: 1080, clipFrames: 75, origin: 'post', skipped: 0,
      components: [{
        matchName: 'AE.ADBE Geometry2', displayName: 'Transformer', intrinsic: null,
        props: [
          { index: 3, name: 'Échelle', values: [180, 150, 130, 118, 110, 105, 102, 101, 100, 100] },
          { index: 7, name: 'Rotation', values: [-12, -8, -5, -3, -1.5, -0.8, -0.3, 0, 0, 0] },
          { index: 9, name: 'Utiliser l\'angle d\'obturateur de la composition', static: false },
          { index: 10, name: 'Angle d\'obturateur', static: 300 }
        ]
      }]
    }),
    diagnose: () => ({ ok: true, text: 'Clip : A001_C004.mov  (V1)\n\n[0] Opacité   matchName: AE.ADBE Opacity\n    #0  Opacité = 100\n\n[1] Trajectoire   matchName: AE.ADBE Motion\n    #0  Position = [0.5, 0.5]\n    #1  Échelle = 100\n\n(mode démo)' }),
    listEffects: a => ({ ok: true, names: EFFECTS.filter(n => !a || !a.filter || new RegExp(a.filter, 'i').test(n)) }),
    adjustmentInfo: () => ({ ok: true, found: true, name: 'Calque de réglage', nodeId: 'demo' }),
    adjustmentFromSelection: () => ({ ok: true, name: 'Calque de réglage', nodeId: 'demo' }),
    rampResolve: a => ({ ok: true, fps: FPS, track: 0, clipStart: 0, clipEnd: 300 * F, clipName: 'A001_C004.mov', regionStart: 300 * F - a.frames * F, regionEnd: 300 * F, frames: a.frames, speed: 1, anchor: a.placement === 'pre' ? 'end' : 'start' }),
    rampApply: async a => {
      await wait(400);
      let at = a.regionStart;
      const created = a.pieces.map(p => { const e = { kind: 'adj', track: 1, start: at, name: 'CutFX · Rampe' }; at += p.frames * F; return e; });
      return { ok: true, pieces: a.pieces.length, sourceFrames: a.pieces.reduce((s, p) => s + p.frames * p.speed / 100, 0), track: 1, created, warnings: [] };
    }
  };

  root.CutFXMock = {
    async call(fn, arg) {
      await wait(fn === 'getContext' ? 5 : 120);
      const h = handlers[fn];
      return h ? h(arg || {}) : { ok: false, error: 'Fonction inconnue : ' + fn };
    }
  };
})(typeof self !== 'undefined' ? self : this);
