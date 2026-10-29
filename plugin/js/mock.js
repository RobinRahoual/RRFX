/* RR FX : faux Premiere utilisé quand le panneau tourne hors de Premiere (mode démo). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  const FPS = 25, TICKS = 254016000000, F = TICKS / FPS;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const EFFECTS = ['Transformer', 'Flou gaussien', 'Flou directionnel', 'Luminosité et contraste', 'Décalage',
    'Déformation de la vague', 'Distorsion de l’objectif', 'Écho', 'Lumetri Color', 'Flou de l’appareil photo'];

  function windows(a) {
    const whole = a.scope === 'sequence';
    const cuts = a.placement === 'markers' ? [100, 150, 200, 250] : a.placement === 'cuts' ? (whole ? [100, 175, 250] : [100, 175]) : whole ? [0, 100, 175, 250] : [300];
    const sides = a.placement === 'clipStart' ? ['post'] : a.placement === 'clipEnd' ? ['pre'] : a.placement === 'full' ? [a.sides[0]] : a.sides;
    const targets = [];
    cuts.forEach(c => sides.forEach(side => {
      const n = a.placement === 'full' ? 90 : a.frames;
      targets.push({ side, start: (side === 'pre' ? c - n : c) * F, end: (side === 'pre' ? c : c + n) * F, frames: n, track: 0, clipTrack: 0, clipStart: 0, clipName: 'A001_C004.mov' });
    }));
    return targets;
  }

  const handlers = {
    compat: () => ({ ok: true, version: root.RRFXHost ? root.RRFXHost.VERSION : '?', app: _T('démo'), appPath: '', missing: [], optional: [] }),
    getContext: () => ({
      ok: true, hasSequence: true, version: _T('démo'), app: _T('démo'), name: _T('Clip démo'), seqId: 'demo-1', fps: FPS, frameW: 1920, frameH: 1080,
      playhead: 12.4, selection: 2, selectionNames: ['A001_C004.mov', 'A001_C007.mov'], markers: 4,
      adj: { name: _T('Calque de réglage'), nodeId: 'demo' }
    }),
    resolve: a => ({ ok: true, fps: FPS, frameW: 1920, frameH: 1080, targets: windows(a), warnings: [] }),
    apply: async a => {
      await wait(a.targets.length * 120);
      return { ok: true, created: a.targets.map(t => ({ kind: a.target === 'clip' ? 'clip' : 'adj', track: 1, start: t.start, name: (t.name || a.name) + ' ' + t.side.toUpperCase(), added: [] })), props: 3, warnings: [] };
    },
    undo: a => ({ ok: true, removed: a.entries.filter(e => e.kind === 'adj').length, effects: 0, skipped: a.entries.filter(e => e.kind !== 'adj').length }),
    capture: () => ({
      ok: true, name: _T('Mon zoom perso'), frames: 10, fps: FPS, frameW: 1920, frameH: 1080, clipFrames: 75, origin: 'post', skipped: 0,
      components: [{
        matchName: 'AE.ADBE Geometry2', displayName: _T('Transformer'), intrinsic: null,
        props: [
          { index: 3, name: _T('Échelle'), values: [180, 150, 130, 118, 110, 105, 102, 101, 100, 100] },
          { index: 7, name: 'Rotation', values: [-12, -8, -5, -3, -1.5, -0.8, -0.3, 0, 0, 0] },
          { index: 9, name: _T('Utiliser l\'angle d\'obturateur de la composition'), static: false },
          { index: 10, name: _T('Angle d\'obturateur'), static: 300 }
        ]
      }]
    }),
    diagnose: () => ({ ok: true, text: _T('Clip : A001_C004.mov  (V1)\n\n[0] Opacité   matchName: AE.ADBE Opacity\n    #0  Opacité = 100\n\n[1] Trajectoire   matchName: AE.ADBE Motion\n    #0  Position = [0.5, 0.5]\n    #1  Échelle = 100\n\n(mode démo)') }),
    listEffects: a => ({ ok: true, names: EFFECTS.filter(n => !a || !a.filter || new RegExp(a.filter, 'i').test(n)) }),
    adjustmentInfo: () => ({ ok: true, found: true, name: _T('Calque de réglage'), nodeId: 'demo' }),
    adjustmentFromSelection: () => ({ ok: true, name: _T('Calque de réglage'), nodeId: 'demo' }),
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
    musicInfo: () => ({ ok: true, name: _T('Musique (démo)'), path: '', track: 0, start: 0, end: 60, inPoint: 0, speed: 1 }),
    projectRushes: () => ({ ok: true, rushes: ['A001_C004.mov', 'A001_C007.mov', 'A002_C001.mov'].map((n, i) => ({ nodeId: 'demo' + i, name: n, path: '', inT: 0, outT: 8 + i * 3 })) }),
    placeRushes: async a => { await wait(a.items.length * 60); return { ok: true, created: a.items.map(it => ({ kind: 'adj', track: 1, start: it.seqStart * TICKS, name: a.label })), track: 1, warnings: [] }; },
    cutAtTimes: a => ({ ok: true, cuts: a.times.length, clips: 2 }),
    syncInfo: () => ({ ok: true, music: null, musicError: _T('Mode démo : pas de musique dans la séquence.'), clips: [], rushes: [] }),
    moveClips: a => ({ ok: true, moved: a.moves.length, warnings: [] }),
    grabFrames: () => ({ ok: false, error: _T('Mode démo : il faut Premiere pour exporter des images de la séquence.') }),
    placeTitle: async a => { await wait(60); return { ok: true, created: [{ kind: 'adj', track: 2, start: a.start * TICKS, name: 'RR FX · Texte' }], track: 2, warnings: [] }; },
    readBlend: () => ({ ok: true, value: 8 }),
    placeAsset: async a => { await wait(80 * a.times.length); return { ok: true, created: a.times.map(t => ({ kind: a.kind === 'audio' ? 'aud' : 'adj', track: 2, start: t * TICKS, name: a.name })), warnings: [] }; },
    importAssets: a => ({ ok: true, imported: a.paths.length, failed: [] }),
    rushList: a => ({ ok: true, fps: FPS, clips: [['C0001.MP4', 0, 120], ['IMG_4512.MOV', 120, 200], ['C0002.MP4', 200, 300], ['DJI_0042.MP4', 300, 380]].filter((c, i) => a.scope !== 'selection' || i < 2).map(([name, s, e]) => ({ track: 0, start: s * F, end: e * F, name, path: '', copy: false })) }),
    placeGrades: async a => { await wait(150); const created = []; a.groups.forEach(g => g.spans.forEach(sp => created.push({ kind: 'adj', track: 1, start: sp.a, name: g.name }))); return { ok: true, created, layers: created.length, replaced: 0, lutSet: created.length, warnings: [] }; },
    formatCopy: async a => { await wait(300); return { ok: true, name: _T('Clip démo (') + a.label + ')', reframed: a.mode === 'reframe' ? 6 : 0, filled: a.mode === 'fill' || a.mode === 'face' ? 6 : 0, faced: a.mode === 'face' ? (a.faces || []).length : 0, blurred: a.mode === 'blur' ? 6 : 0, width: a.width, height: a.height, warnings: [] }; },
    duckMusic: a => ({ ok: true, keys: a.keys.length, created: [{ kind: 'level', track: a.track, start: a.start * TICKS, value: 0.17, name: _T('Musique (démo)') }], warnings: [] }),
    gainKeys: a => ({ ok: true, keys: a.keys.length, created: [{ kind: 'level', track: a.track, start: a.start * TICKS, value: 0.17, name: a.label || _T('Voix (démo)') }], warnings: [] }),
    listSequences: () => ({ ok: true, active: 'demo-1', sequences: seqs.slice() }),
    versionSequence: async a => { await wait(150); const q = { id: 'demo-v' + seqs.length, name: a.name, w: 1920, h: 1080, end: 60 }; seqs.push(q); return { ok: true, id: q.id, name: q.name, of: _T('Clip démo'), ofId: 'demo-1' }; },
    fitMusic: async a => {
      if (a.plan) return { ok: true, music: { name: _T('Musique (démo)'), track: 1, start: 0, end: 60, path: '' }, videoEnd: 45 };
      await wait(250);
      return { ok: true, removed: a.b > a.a ? 1 : 0, moved: a.b > a.a ? 1 : 0, refused: 0, end: 60 - (a.b - a.a || 0), lastStart: a.a || 0, track: 1, name: _T('Musique (démo)'), warnings: [] };
    },
    importToBin: async a => { await wait(100); const fresh = a.paths.filter(p => !imported.has(p)); fresh.forEach(p => imported.add(p)); return { ok: true, imported: fresh.map(p => p.split(/[\\/]/).pop()), skipped: a.paths.length - fresh.length }; },
    tidyProject: async a => {
      await wait(150);
      const counts = { video: 6, audio: 2, image: 3, sequence: 2 }, unused = ['C0007.MP4', 'C0008.MP4', 'IMG_4519.MOV'];
      const created = Array.from({ length: 13 + (a.unused ? unused.length : 0) }, (x, i) => ({ kind: 'move', id: 'p' + i, from: 'root', name: 'item' + i }));
      return a.dry ? { ok: true, counts, loose: 13, unused, unusedCount: unused.length } : { ok: true, counts, moved: 13, parked: a.unused ? unused.length : 0, created };
    },
    renameItems: a => (a.dry ? { ok: true, items: [{ id: 'p1', name: 'C0001.MP4' }, { id: 'p2', name: 'C0002.MP4' }, { id: 'p3', name: 'IMG_4512.MOV' }] }
      : { ok: true, renamed: a.ids.map((id, i) => ({ id, old: ['C0001.MP4', 'C0002.MP4', 'IMG_4512.MOV'][i] || id, name: a.names[i] })) }),
    activityPing: () => ({ ok: true, project: _T('Projet démo.prproj'), path: '/demo/Projet démo.prproj', sig: 'demo|' + Math.floor(Date.now() / 90000) }),
    proxyPresets: () => ({ ok: true, presets: [{ path: '/demo/H.264 Low Resolution Proxy.epr', name: 'H.264 Low Resolution Proxy' }, { path: '/demo/ProRes Low Resolution Proxy.epr', name: 'ProRes Low Resolution Proxy' }] }),
    makeProxies: async a => { await wait(200); proxies.total = 4; proxies.started = Date.now(); return { ok: true, queued: ['C0001.MP4', 'IMG_4512.MOV', 'C0002.MP4', 'DJI_0042.MP4'].map((name, i) => ({ job: String(i + 1), id: 'p' + i, name })), skipped: 0 }; },
    proxyStatus: () => { const n = Math.min(proxies.total, Math.floor((Date.now() - proxies.started) / 700)); return { ok: true, total: proxies.total, finished: n, attached: n, enabled: proxies.on }; },
    setProxies: a => { proxies.on = !!a.on; return { ok: true, enabled: proxies.on }; },
    deleteSequence: a => { const i = seqs.findIndex(q => q.id === a.id); if (a.id === 'demo-1') return { ok: false, error: _T('C\'est la séquence ouverte : ouvre-en une autre d\'abord.') }; if (i >= 0) seqs.splice(i, 1); return { ok: true, id: a.id }; },
    openSequence: a => ({ ok: true, id: a.id, name: a.id }),
    extractCopy: async a => { await wait(200); return { ok: true, name: a.name, id: 'demo-x' + Math.round(a.a), seconds: a.b - a.a, kept: 6, warnings: [] }; },
    preflight: async () => {
      await wait(250);
      return { ok: true, duration: 60, fps: FPS, w: 1920, h: 1080, issues: [
        { level: 'error', t: 12.4, where: 'V1', text: _T('Média hors ligne : A001_C009.mov') },
        { level: 'error', t: 31.2, where: 'V', text: _T('Image noire : 6 image(s) sans plan') },
        { level: 'warn', t: 44, where: 'A2', text: _T('Volume poussé à +9 dB : risque de saturation (Musique.wav)') },
        { level: 'warn', t: 52.5, where: 'V3', text: _T('Texte hors zone sûre : RR FX · Texte') }] };
    },
    placeStills: async a => { await wait(40 * a.items.length); return { ok: true, track: 3, end: Math.max(...a.items.map(i => i.t + i.dur)), created: a.items.map(i => ({ kind: 'adj', track: 3, start: i.t * TICKS, name: a.name || 'Image' })), warnings: [] }; },
    newFromTemplate: async a => { await wait(200); return { ok: true, name: a.name, id: 'demo-new', clips: 3, adjPlaced: !!a.adj, warnings: [] }; },
    voiceLevel: a => ({ ok: true, done: a.clips.length, cleaned: a.denoise ? a.clips.length : 0, created: a.clips.map(c => ({ kind: 'level', track: c.track, start: c.start * TICKS, value: 0.17, name: 'Interview_A.mp4' })), warnings: [] }),
    speechInfo: () => ({ ok: true, fps: FPS, clips: [{ kind: 'video', track: 0, name: 'Interview_A.mp4', path: '', start: 0, end: 18, inPoint: 0, speed: 1, audio: [{ track: 0, start: 0 }] }], tracks: { video: [0], audio: [0] } }),
    cutSilences: async a => { await wait(400); const sec = a.ranges.reduce((s, r) => s + r.b - r.a, 0); return { ok: true, removed: a.ranges.length * 2, ranges: a.ranges.length, seconds: sec, moved: a.ranges.length * 2, name: a.copy ? _T('Clip démo (sans silences)') : _T('Clip démo'), copy: !!a.copy, warnings: [] }; },
    selfTest: async () => { await wait(600); return { ok: true, app: _T('démo'), version: root.RRFXHost ? root.RRFXHost.VERSION : '', frame: '', results: [['clone', _T('Copier une séquence')], ['adj', _T('Calque de réglage dans le projet')], ['lumetri', _T('Ajouter Lumetri Color (QE)')], ['lut', _T('Charger une LUT dans Lumetri (LUT d\'entrée)')], ['insert', _T('Insérer une piste au milieu (QE)')], ['frame', _T('Exporter une image de la timeline')], ['reframe', _T('Effet Recadrage automatique disponible')], ['cleanup', _T('Supprimer la séquence de test')]].map(([id, label]) => ({ id, label, ok: true, detail: _T('mode démo') })) }; },
    setPlayhead: a => ({ ok: true, t: a.t }),
    logConvert: async a => { await wait(200); return { ok: true, created: [{ kind: 'adj', track: 1, start: 0, name: a.name }], layers: 1, replaced: 0, lutSet: a.lutPath ? 1 : 0, warnings: [] }; },
    multicamSwitch: a => ({ ok: true, segments: a.times.length + 1, switches: a.times.length, cams: 2, disabled: a.times.length + 1, plan: [], entry: { kind: 'mc', tracks: [0, 1], a: 0, b: 0 } })
  };
  const markers = [];
  const seqs = [{ id: 'demo-1', name: _T('Clip démo'), w: 1920, h: 1080, end: 60 }, { id: 'demo-2', name: _T('Interview client'), w: 1920, h: 1080, end: 312 },
    { id: 'demo-3', name: 'Teaser 9:16', w: 1080, h: 1920, end: 28 }];
  const imported = new Set(), proxies = { total: 0, started: 0, on: false };

  root.RRFXMock = {
    async call(fn, arg) {
      await wait(fn === 'getContext' ? 5 : 120);
      const h = handlers[fn];
      return h ? h(arg || {}) : { ok: false, error: _T('Fonction inconnue : ') + fn };
    }
  };
})(typeof self !== 'undefined' ? self : this);
