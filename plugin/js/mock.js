/* RR FX — faux Premiere utilisé quand le panneau tourne hors de Premiere (mode démo). */
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
    compat: () => ({ ok: true, version: root.RRFXHost ? root.RRFXHost.VERSION : '?', app: 'démo', appPath: '', missing: [], optional: [] }),
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
      const created = a.pieces.map(p => { const e = { kind: 'adj', track: 1, start: at, name: 'RR FX · Rampe' }; at += p.frames * F; return e; });
      return { ok: true, pieces: a.pieces.length, sourceFrames: a.pieces.reduce((s, p) => s + p.frames * p.speed / 100, 0), track: 1, created, warnings: [] };
    },
    // 1.3 : musique, montage, textes, nettoyage (la musique de démo n'a pas de fichier : choisis-en un).
    markerList: () => ({ ok: true, markers: markers.slice(), playhead: 0, range: null }),
    addMarkers: a => {
      const removed = a.replace ? markers.length : 0;
      if (a.replace) markers.length = 0;
      a.times.forEach(t => markers.push({ t, name: a.name }));
      markers.sort((x, y) => x.t - y.t);
      return { ok: true, added: a.times.length, removed };
    },
    clearAll: a => { const n = a.markers ? markers.length : 0; if (a.markers) markers.length = 0; return { ok: true, removed: 3, markers: n }; },
    musicInfo: () => ({ ok: true, name: 'Musique (démo)', path: '', track: 0, start: 0, end: 60, inPoint: 0, speed: 1 }),
    projectRushes: () => ({ ok: true, rushes: ['A001_C004.mov', 'A001_C007.mov', 'A002_C001.mov'].map((n, i) => ({ nodeId: 'demo' + i, name: n, path: '', inT: 0, outT: 8 + i * 3 })) }),
    placeRushes: async a => { await wait(a.items.length * 60); return { ok: true, created: a.items.map(it => ({ kind: 'adj', track: 1, start: it.seqStart * TICKS, name: a.label })), track: 1, warnings: [] }; },
    cutAtTimes: a => ({ ok: true, cuts: a.times.length, clips: 2 }),
    syncInfo: () => ({ ok: true, music: null, musicError: 'Mode démo : pas de musique dans la séquence.', clips: [], rushes: [] }),
    moveClips: a => ({ ok: true, moved: a.moves.length, warnings: [] }),
    grabFrames: () => ({ ok: false, error: 'Mode démo : il faut Premiere pour exporter des images de la séquence.' }),
    placeTitle: async a => { await wait(60); return { ok: true, created: [{ kind: 'adj', track: 2, start: a.start * TICKS, name: 'RR FX · Texte' }], track: 2, warnings: [] }; },
    readBlend: () => ({ ok: true, value: 8 }),
    placeAsset: async a => { await wait(80 * a.times.length); return { ok: true, created: a.times.map(t => ({ kind: a.kind === 'audio' ? 'aud' : 'adj', track: 2, start: t * TICKS, name: a.name })), warnings: [] }; },
    importAssets: a => ({ ok: true, imported: a.paths.length, failed: [] }),
    logConvert: async a => { await wait(200); return { ok: true, created: [{ kind: 'adj', track: 1, start: 0, name: a.name }], layers: 1, replaced: 0, lutSet: a.lutPath ? 1 : 0, warnings: [] }; },
    multicamSwitch: a => ({ ok: true, segments: a.times.length + 1, switches: a.times.length, cams: 2, disabled: a.times.length + 1, plan: [], entry: { kind: 'mc', tracks: [0, 1], a: 0, b: 0 } })
  };
  const markers = [];

  root.RRFXMock = {
    async call(fn, arg) {
      await wait(fn === 'getContext' ? 5 : 120);
      const h = handlers[fn];
      return h ? h(arg || {}) : { ok: false, error: 'Fonction inconnue : ' + fn };
    }
  };
})(typeof self !== 'undefined' ? self : this);
