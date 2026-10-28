/* CutFX — built-in effect library.
   Each recipe returns the Premiere effects to add and, per property, either a
   constant or a function of the frame index i. See core.makeCtx for `c`. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CutFXLibrary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = [
    { id: 'flash', label: 'Flashs' },
    { id: 'flicker', label: 'Flickers' },
    { id: 'blur', label: 'Flous' },
    { id: 'zoom', label: 'Zooms' },
    { id: 'shake', label: 'Shakes' },
    { id: 'slide', label: 'Slides' },
    { id: 'distort', label: 'Distorsions' },
    { id: 'time', label: 'Motion blur' }
  ];

  const range = (key, label, def, min, max, unit, step) => ({ key, label, type: 'range', def, min, max, unit: unit || '', step: step || 1 });
  const select = (key, label, def, options) => ({ key, label, type: 'select', def, options });
  const SEED = range('seed', 'Variation', 1, 1, 99, '');
  const MBLUR = def => range('mblur', 'Flou de mouvement', def, 0, 360, '°');

  const DIRS = {
    left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]
  };
  const DIR_OPTIONS = [
    { v: 'left', label: '←' }, { v: 'right', label: '→' }, { v: 'up', label: '↑' }, { v: 'down', label: '↓' }
  ];

  const transformBlur = (c, extra) => Object.assign({ compShutter: false, shutter: c.p.mblur == null ? 0 : c.p.mblur }, extra);

  function shake(c, o) {
    const p = c.p, amp = p.amount / 100 * c.k;
    const freq = 0.08 + 0.9 * p.freq / 100;
    const ax = p.axis === 'y' ? 0 : 1, ay = p.axis === 'x' ? 0 : 1;
    const s = p.seed;
    const fx = [{
      type: 'transform',
      props: transformBlur(c, {
        position: i => [0.5 + ax * amp * c.env(i) * c.noise(i * freq, s), 0.5 + ay * amp * c.env(i) * c.noise(i * freq, s + 17)],
        rotation: i => p.rotation * c.k * c.env(i) * c.noise(i * freq, s + 31),
        scale: i => 100 + (p.amount * 2.2 + (o && o.punch ? o.punch : 0)) * c.k * c.env(i)
      })
    }];
    if (o && o.blur) fx.push({ type: 'gaussian', props: { blur: i => o.blur * c.k * c.env(i), repeat: true } });
    return fx;
  }

  function slide(c, o) {
    const p = c.p, d = DIRS[p.dir] || DIRS.right, D = p.distance / 100;
    const sg = c.sign;
    const fx = [
      { type: 'offset', props: { center: i => [0.5 + sg * D * c.env(i) * d[0], 0.5 + sg * D * c.env(i) * d[1]], blend: 0 } },
      { type: 'directional', props: { direction: d[0] !== 0 ? 90 : 0, length: i => p.blur * c.k * c.vel(i) * c.env(i) * 1.4 } }
    ];
    if (o && o.punch) fx.push({ type: 'transform', props: transformBlur(c, { scale: i => 100 + o.punch * c.k * c.env(i) }) });
    return fx;
  }

  const EFFECTS = [
    // ---------------------------------------------------------------- flashes
    {
      id: 'flash-white', name: 'Flash blanc', cat: 'flash', frames: 5, curve: 'expoIn',
      desc: 'Montée de luminosité jusqu\'au blanc sur la coupe.',
      params: [range('glow', 'Glow', 25, 0, 100, '%')],
      build: c => {
        const fx = [{ type: 'bc', props: { brightness: i => Math.min(100, 100 * c.k * c.env(i)), contrast: i => -25 * c.k * c.env(i) } }];
        if (c.k > 1) fx.push({ type: 'bc', props: { brightness: i => Math.min(100, (c.k - 1) * 100 * c.env(i)) } });
        if (c.p.glow > 0) fx.push({ type: 'gaussian', props: { blur: i => c.p.glow * 0.8 * c.k * c.env(i), repeat: true } });
        return fx;
      }
    },
    {
      id: 'flash-glow', name: 'Glow flash', cat: 'flash', frames: 7, curve: 'easeIn',
      desc: 'Flash doux et diffus, avec halo et léger zoom.',
      params: [range('size', 'Taille du halo', 45, 0, 150, ''), range('bloom', 'Bloom', 4, 0, 20, '%')],
      build: c => [
        { type: 'bc', props: { brightness: i => Math.min(100, 60 * c.k * c.env(i)), contrast: i => 12 * c.k * c.env(i) } },
        { type: 'gaussian', props: { blur: i => c.p.size * c.k * c.env(i), repeat: true } },
        { type: 'transform', props: { scale: i => 100 + c.p.bloom * c.k * c.env(i) } }
      ]
    },
    {
      id: 'flash-black', name: 'Dip noir', cat: 'flash', frames: 4, curve: 'easeIn',
      desc: 'Passage rapide au noir sur la coupe.',
      params: [],
      build: c => [{ type: 'transform', props: { opacity: i => c.clamp(100 - 100 * c.k * c.env(i), 0, 100) } }]
    },
    {
      id: 'flash-double', name: 'Double flash', cat: 'flash', frames: 8, noCurve: true,
      desc: 'Deux flashs successifs, le plus fort sur la coupe.',
      params: [range('gap', 'Écart', 45, 15, 80, '%')],
      build: c => {
        const g = (t, m, s) => Math.exp(-Math.pow((t - m) / s, 2));
        const m2 = 1 - c.p.gap / 100;
        const w = i => Math.max(g(c.tp(i), 1, 0.13), 0.75 * g(c.tp(i), m2, 0.1));
        return [{ type: 'bc', props: { brightness: i => Math.min(100, 100 * c.k * w(i)), contrast: i => -20 * c.k * w(i) } }];
      }
    },

    // ---------------------------------------------------------------- flickers
    {
      id: 'flicker', name: 'Flicker', cat: 'flicker', frames: 10, curve: 'easeIn',
      desc: 'Coupures aléatoires image par image, plus denses près de la coupe.',
      params: [range('density', 'Densité', 55, 5, 100, '%'), range('depth', 'Profondeur', 85, 10, 100, '%'), SEED],
      build: c => [{
        type: 'transform',
        props: { opacity: i => (c.rand(i, c.p.seed) < c.p.density / 100 * (0.35 + 0.65 * c.env(i))) ? c.clamp(100 - c.p.depth * c.k, 0, 100) : 100 }
      }]
    },
    {
      id: 'strobe', name: 'Stroboscope', cat: 'flicker', frames: 8, curve: 'linear',
      desc: 'Alternance régulière blanc ou noir.',
      params: [range('rate', 'Cadence', 1, 1, 4, 'i'), select('mode', 'Couleur', 'white', [{ v: 'white', label: 'Blanc' }, { v: 'black', label: 'Noir' }])],
      build: c => {
        const on = i => Math.floor(i / c.p.rate) % 2 === 0 ? 1 : 0;
        const w = i => on(i) * (0.4 + 0.6 * c.env(i));
        if (c.p.mode === 'black') return [{ type: 'transform', props: { opacity: i => c.clamp(100 - 100 * c.k * w(i), 0, 100) } }];
        return [{ type: 'bc', props: { brightness: i => Math.min(100, 100 * c.k * w(i)) } }];
      }
    },

    // ---------------------------------------------------------------- blurs
    {
      id: 'defocus', name: 'Défocus', cat: 'blur', frames: 10, curve: 'easeIn',
      desc: 'Flou gaussien qui monte jusqu\'à la coupe.',
      params: [range('amount', 'Flou', 60, 0, 300, '')],
      build: c => [{ type: 'gaussian', props: { blur: i => c.p.amount * c.k * c.env(i), repeat: true } }]
    },
    {
      id: 'blur-directional', name: 'Flou directionnel', cat: 'blur', frames: 8, curve: 'easeIn',
      desc: 'Traînée de flou dans une direction.',
      params: [range('amount', 'Longueur', 80, 0, 300, ''), range('angle', 'Direction', 90, 0, 360, '°')],
      build: c => [{ type: 'directional', props: { direction: c.p.angle, length: i => c.p.amount * c.k * c.env(i) } }]
    },

    // ---------------------------------------------------------------- zooms
    {
      id: 'zoom-in', name: 'Zoom in', cat: 'zoom', frames: 8, curve: 'expoIn',
      desc: 'Zoom avant avec flou de mouvement réel (Transformer).',
      params: [range('amount', 'Zoom', 50, 0, 300, '%'), MBLUR(270)],
      build: c => [{ type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * c.env(i) }) }]
    },
    {
      id: 'zoom-out', name: 'Zoom out', cat: 'zoom', frames: 8, curve: 'expoIn',
      desc: 'Zoom arrière. Au-delà de ~20 % les bords noirs apparaissent.',
      params: [range('amount', 'Zoom', 20, 0, 80, '%'), MBLUR(270)],
      build: c => [{ type: 'transform', props: transformBlur(c, { scale: i => 100 - Math.min(90, c.p.amount * c.k * c.env(i)) }) }]
    },
    {
      id: 'zoom-bounce', name: 'Zoom rebond', cat: 'zoom', frames: 12, noCurve: true,
      desc: 'Punch de zoom avec rebond amorti.',
      params: [range('amount', 'Zoom', 30, 0, 150, '%'), range('bounces', 'Rebonds', 2, 1, 5, ''), MBLUR(200)],
      build: c => {
        const v = i => { const u = 1 - c.tp(i); const s = (1 - u) * Math.exp(-3 * u) * Math.cos(Math.PI * c.p.bounces * u); return s < 0 ? s * 0.5 : s; };
        return [{ type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * v(i) }) }];
      }
    },
    {
      id: 'zoom-spin', name: 'Zoom rotation', cat: 'zoom', frames: 10, curve: 'expoIn',
      desc: 'Zoom et rotation enchaînés à travers la coupe.',
      params: [range('amount', 'Zoom', 40, 0, 200, '%'), range('angle', 'Rotation', 90, 0, 360, '°'),
        select('sens', 'Sens', 'cw', [{ v: 'cw', label: 'Horaire' }, { v: 'ccw', label: 'Anti-horaire' }]), MBLUR(300)],
      build: c => {
        const dir = c.p.sens === 'ccw' ? -1 : 1;
        return [{ type: 'transform', props: transformBlur(c, {
          scale: i => 100 + c.p.amount * c.k * c.env(i),
          rotation: i => c.sign * dir * c.p.angle * c.k * c.env(i)
        }) }];
      }
    },

    // ---------------------------------------------------------------- shakes
    {
      id: 'shake', name: 'Shake', cat: 'shake', frames: 12, curve: 'easeIn',
      desc: 'Tremblement caméra avec zoom de compensation.',
      params: [range('amount', 'Amplitude', 3, 0, 20, '%', 0.5), range('freq', 'Fréquence', 55, 1, 100, '%'), range('rotation', 'Rotation', 2, 0, 20, '°', 0.5),
        select('axis', 'Axes', 'xy', [{ v: 'xy', label: 'X + Y' }, { v: 'x', label: 'X' }, { v: 'y', label: 'Y' }]), MBLUR(180), SEED],
      build: c => shake(c)
    },
    {
      id: 'shake-impact', name: 'Impact', cat: 'shake', frames: 10, curve: 'expoIn',
      desc: 'Choc violent : shake, punch de zoom et flou.',
      params: [range('amount', 'Amplitude', 6, 0, 20, '%', 0.5), range('freq', 'Fréquence', 75, 1, 100, '%'), range('rotation', 'Rotation', 4, 0, 20, '°', 0.5),
        select('axis', 'Axes', 'xy', [{ v: 'xy', label: 'X + Y' }, { v: 'x', label: 'X' }, { v: 'y', label: 'Y' }]), MBLUR(240), SEED],
      build: c => shake(c, { punch: 10, blur: 8 })
    },
    {
      id: 'shake-bass', name: 'Bass drop', cat: 'shake', frames: 8, curve: 'expoIn',
      desc: 'Secousse verticale serrée, idéale sur un kick.',
      params: [range('amount', 'Amplitude', 4, 0, 20, '%', 0.5), range('freq', 'Fréquence', 95, 1, 100, '%'), range('rotation', 'Rotation', 0, 0, 20, '°', 0.5),
        select('axis', 'Axes', 'y', [{ v: 'xy', label: 'X + Y' }, { v: 'x', label: 'X' }, { v: 'y', label: 'Y' }]), MBLUR(180), SEED],
      build: c => shake(c)
    },

    // ---------------------------------------------------------------- slides
    {
      id: 'slide', name: 'Slide', cat: 'slide', frames: 8, curve: 'expoIn',
      desc: 'Glissement de l\'image (bords répétés) avec flou directionnel.',
      params: [select('dir', 'Direction', 'left', DIR_OPTIONS), range('distance', 'Distance', 60, 0, 100, '%'), range('blur', 'Flou', 120, 0, 300, '')],
      build: c => slide(c)
    },
    {
      id: 'whip-pan', name: 'Whip pan', cat: 'slide', frames: 6, curve: 'expoIn',
      desc: 'Panoramique filé très rapide.',
      params: [select('dir', 'Direction', 'left', DIR_OPTIONS), range('distance', 'Distance', 100, 0, 100, '%'), range('blur', 'Flou', 260, 0, 400, ''), MBLUR(180)],
      build: c => slide(c, { punch: 6 })
    },

    // ---------------------------------------------------------------- distortions
    {
      id: 'wave', name: 'Onde', cat: 'distort', frames: 10, curve: 'easeIn',
      desc: 'Ondulation de l\'image (Déformation de la vague).',
      params: [range('amount', 'Hauteur', 25, 0, 100, ''), range('width', 'Largeur', 60, 1, 200, '')],
      build: c => [{ type: 'wave', props: { height: i => c.p.amount * c.k * c.env(i), width: c.p.width } }]
    },
    {
      id: 'lens', name: 'Bulge', cat: 'distort', frames: 8, curve: 'easeIn',
      desc: 'Bombement d\'objectif.',
      params: [range('amount', 'Courbure', -45, -100, 100, '')],
      build: c => [{ type: 'lens', props: { curvature: i => c.p.amount * c.k * c.env(i) } }]
    },
    {
      id: 'glitch', name: 'Glitch', cat: 'distort', frames: 10, curve: 'easeIn',
      desc: 'Sauts d\'image, ondes et pics de luminosité aléatoires.',
      params: [range('density', 'Densité', 50, 5, 100, '%'), SEED],
      build: c => {
        const s = c.p.seed;
        const on = i => c.rand(i, s) < c.p.density / 100 * (0.3 + 0.7 * c.env(i));
        return [
          { type: 'offset', props: { center: i => on(i) ? [0.5 + (c.rand(i, s + 7) - 0.5) * 0.3 * c.k, 0.5 + (c.rand(i, s + 9) - 0.5) * 0.06 * c.k] : [0.5, 0.5], blend: 0 } },
          { type: 'wave', props: { height: i => on(i) ? 18 * c.k * c.rand(i, s + 3) : 0, width: 22 } },
          { type: 'bc', props: { brightness: i => on(i) ? c.clamp((c.rand(i, s + 5) - 0.35) * 80 * c.k, -100, 100) : 0 } }
        ];
      }
    },

    // ---------------------------------------------------------------- motion blur
    {
      id: 'echo-blur', name: 'Motion blur', cat: 'time', frames: 6, curve: 'easeIn', target: 'copy',
      desc: 'Vrai flou de mouvement par fusion des images précédentes (Écho), sur une copie du plan posée au-dessus.',
      params: [range('echoes', 'Images fusionnées', 4, 1, 10, '')],
      build: c => {
        const n = i => Math.round(c.p.echoes * c.k * c.env(i));
        return [{ type: 'echo', props: { time: -1 / c.fps, count: n, intensity: i => Math.round(1000 / (n(i) + 1)) / 1000, decay: 1 } }];
      }
    }
  ];

  // ---------------------------------------------------------------- animations de texte
  // Entrée = côté POST (de l'état caché à l'état normal), sortie = côté PRE.
  const backOut = t => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };
  const TITLE_ANIMS = [
    { id: 'fade', name: 'Fondu', frames: 6, curve: 'easeInOut', params: [],
      build: c => [{ type: 'transform', props: { opacity: i => 100 - 100 * c.env(i) } }] },
    { id: 'pop', name: 'Pop', frames: 7, noCurve: true, params: [range('amount', 'Rebond', 100, 0, 200, '%')],
      build: c => {
        // Progression vers l'état normal : 1 = visible ; avec un léger dépassement à l'entrée.
        const shown = i => (c.side === 'post' ? backOut(1 - c.tp(i)) : 1 - c.tp(i) * c.tp(i));
        const k = c.p.amount / 100;
        const scale = i => { const v = shown(i); return 100 * Math.max(0, v > 1 ? 1 + (v - 1) * k : v); };
        return [{ type: 'transform', props: { scale, opacity: i => c.clamp(100 * Math.min(1, shown(i) * 2), 0, 100) } }];
      } },
    { id: 'zoom-blur', name: 'Zoom flou', frames: 8, curve: 'expoIn', params: [range('amount', 'Zoom', 30, 0, 150, '%'), range('blur', 'Flou', 30, 0, 150, '')],
      build: c => [
        { type: 'transform', props: { scale: i => 100 + c.p.amount * c.env(i), opacity: i => 100 - 100 * c.env(i), compShutter: false, shutter: 180 } },
        { type: 'gaussian', props: { blur: i => c.p.blur * c.env(i), repeat: true } }
      ] },
    { id: 'slide-up', name: 'Glissement', frames: 8, curve: 'expoIn', params: [select('dir', 'Depuis', 'down', [{ v: 'down', label: '↑' }, { v: 'up', label: '↓' }, { v: 'left', label: '→' }, { v: 'right', label: '←' }]), range('distance', 'Distance', 8, 0, 50, '%')],
      build: c => {
        const d = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[c.p.dir] || [0, 1], D = c.p.distance / 100;
        return [
          { type: 'transform', props: { position: i => [0.5 + d[0] * D * c.env(i), 0.5 + d[1] * D * c.env(i)], opacity: i => 100 - 100 * c.env(i), compShutter: false, shutter: 180 } },
          { type: 'directional', props: { direction: d[0] ? 90 : 0, length: i => 60 * c.vel(i) * c.env(i) } }
        ];
      } },
    { id: 'blur', name: 'Flou', frames: 8, curve: 'easeInOut', params: [range('blur', 'Flou', 40, 0, 200, '')],
      build: c => [
        { type: 'gaussian', props: { blur: i => c.p.blur * c.env(i), repeat: true } },
        { type: 'transform', props: { opacity: i => 100 - 100 * c.env(i) } }
      ] },
    { id: 'impact', name: 'Impact', frames: 8, curve: 'expoIn', params: [range('amount', 'Secousse', 3, 0, 15, '%', 0.5)],
      build: c => [{ type: 'transform', props: {
        scale: i => 100 + 18 * c.env(i),
        position: i => [0.5 + c.p.amount / 100 * c.env(i) * c.noise(i * 0.8, 3), 0.5 + c.p.amount / 100 * c.env(i) * c.noise(i * 0.8, 9)],
        opacity: i => c.side === 'post' ? 100 : 100 - 100 * c.env(i),
        compShutter: false, shutter: 220
      } }] },
    { id: 'none', name: 'Aucune', frames: 0, params: [], build: () => [] }
  ];

  const byId = {};
  EFFECTS.forEach(e => { byId[e.id] = e; });

  const titleById = {};
  TITLE_ANIMS.forEach(a => { titleById[a.id] = a; });

  return { CATEGORIES, EFFECTS, byId, TITLE_ANIMS, titleById };
});
