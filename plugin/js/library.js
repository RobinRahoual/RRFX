/* RR FX : built-in effect library.
   Each recipe returns the Premiere effects to add and, per property, either a
   constant or a function of the frame index i. See core.makeCtx for `c`. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXLibrary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const CATEGORIES = [
    { id: 'flash', label: _T('Flashs') },
    { id: 'flicker', label: 'Flickers' },
    { id: 'blur', label: _T('Flous') },
    { id: 'zoom', label: 'Zooms' },
    { id: 'shake', label: 'Shakes' },
    { id: 'slide', label: 'Slides' },
    { id: 'distort', label: _T('Distorsions') },
    { id: 'motion', label: _T('Mouvements') },
    { id: 'time', label: 'Motion blur' }
  ];

  const range = (key, label, def, min, max, unit, step) => ({ key, label, type: 'range', def, min, max, unit: unit || '', step: step || 1 });
  const select = (key, label, def, options) => ({ key, label, type: 'select', def, options });
  const SEED = range('seed', 'Variation', 1, 1, 99, '');
  const MBLUR = def => range('mblur', _T('Flou de mouvement'), def, 0, 360, '°');

  const DIRS = {
    left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]
  };
  const DIR_OPTIONS = [
    { v: 'left', label: '←' }, { v: 'right', label: '→' }, { v: 'up', label: '↑' }, { v: 'down', label: '↓' }
  ];

  const backOut = t => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };

  /* Zoom « visage » : c.p.face = position des yeux à chaque image (0 à 1), trouvée par le
     panneau (faces.js) ; sans elle (aperçu), des yeux typiques d'une face cam. Ancre au centre :
     « à leur place », les yeux restent au même endroit de l'écran ; « recentrés », ils vont au
     milieu, au tiers haut, sans laisser voir de bord. */
  const FACE_EYES = [0.5, 0.4];
  function faceZoom(c, grow) {
    const eye = i => (c.p.face && c.p.face.length ? c.p.face[Math.min(c.p.face.length - 1, Math.max(0, i))] : FACE_EYES);
    const z = i => 1 + c.p.amount / 100 * c.k * grow(i);
    // « lock » (stabiliser) : les yeux sont tenus à leur position moyenne dans le plan.
    let hold = [0.5, 0.4];
    if (c.p.frame === 'lock' && c.p.face && c.p.face.length) {
      const med = j => c.p.face.map(e => e[j]).sort((a, b) => a - b)[c.p.face.length >> 1];
      hold = [med(0), med(1)];
    }
    const pos = i => {
      const e = eye(i), zz = z(i);
      if (c.p.frame !== 'center' && c.p.frame !== 'lock') return [0.5 + (e[0] - 0.5) * (1 - zz), 0.5 + (e[1] - 0.5) * (1 - zz)];
      const m = (zz - 1) / 2, cl = v => Math.min(0.5 + m, Math.max(0.5 - m, v));
      return [cl(hold[0] - (e[0] - 0.5) * zz), cl(hold[1] - (e[1] - 0.5) * zz)];
    };
    return [{ type: 'transform', props: { scale: i => 100 * z(i), position: pos } }];
  }
  const FACE_PARAMS = [
    select('frame', _T('Yeux'), 'keep', [{ v: 'keep', label: _T('À leur place') }, { v: 'center', label: _T('Recentrés') }]),
    select('follow', _T('Suivi'), 'smooth', [{ v: 'smooth', label: _T('Doux') }, { v: 'tight', label: _T('Serré') }, { v: 'fixed', label: _T('Fixe') }])
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
      id: 'flash-white', name: _T('Flash blanc'), cat: 'flash', frames: 5, curve: 'expoIn',
      desc: _T('Montée de luminosité jusqu\'au blanc sur la coupe.'),
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
      desc: _T('Flash doux et diffus, avec halo et léger zoom.'),
      params: [range('size', _T('Taille du halo'), 45, 0, 150, ''), range('bloom', 'Bloom', 4, 0, 20, '%')],
      build: c => [
        { type: 'bc', props: { brightness: i => Math.min(100, 60 * c.k * c.env(i)), contrast: i => 12 * c.k * c.env(i) } },
        { type: 'gaussian', props: { blur: i => c.p.size * c.k * c.env(i), repeat: true } },
        { type: 'transform', props: { scale: i => 100 + c.p.bloom * c.k * c.env(i) } }
      ]
    },
    {
      id: 'flash-black', name: _T('Dip noir'), cat: 'flash', frames: 4, curve: 'easeIn',
      desc: _T('Passage rapide au noir sur la coupe.'),
      params: [],
      build: c => [{ type: 'transform', props: { opacity: i => c.clamp(100 - 100 * c.k * c.env(i), 0, 100) } }]
    },
    {
      id: 'flash-double', name: 'Double flash', cat: 'flash', frames: 8, noCurve: true,
      desc: _T('Deux flashs successifs, le plus fort sur la coupe.'),
      params: [range('gap', _T('Écart'), 45, 15, 80, '%')],
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
      desc: _T('Coupures aléatoires image par image, plus denses près de la coupe.'),
      params: [range('density', _T('Densité'), 55, 5, 100, '%'), range('depth', _T('Profondeur'), 85, 10, 100, '%'), SEED],
      build: c => [{
        type: 'transform',
        props: { opacity: i => (c.rand(i, c.p.seed) < c.p.density / 100 * (0.35 + 0.65 * c.env(i))) ? c.clamp(100 - c.p.depth * c.k, 0, 100) : 100 }
      }]
    },
    {
      id: 'strobe', name: _T('Stroboscope'), cat: 'flicker', frames: 8, curve: 'linear',
      desc: _T('Alternance régulière blanc ou noir.'),
      params: [range('rate', _T('Cadence'), 1, 1, 4, 'i'), select('mode', _T('Couleur'), 'white', [{ v: 'white', label: _T('Blanc') }, { v: 'black', label: _T('Noir') }])],
      build: c => {
        const on = i => Math.floor(i / c.p.rate) % 2 === 0 ? 1 : 0;
        const w = i => on(i) * (0.4 + 0.6 * c.env(i));
        if (c.p.mode === 'black') return [{ type: 'transform', props: { opacity: i => c.clamp(100 - 100 * c.k * w(i), 0, 100) } }];
        return [{ type: 'bc', props: { brightness: i => Math.min(100, 100 * c.k * w(i)) } }];
      }
    },

    // ---------------------------------------------------------------- blurs
    {
      id: 'defocus', name: _T('Défocus'), cat: 'blur', frames: 10, curve: 'easeIn',
      desc: _T('Flou gaussien qui monte jusqu\'à la coupe.'),
      params: [range('amount', _T('Flou'), 60, 0, 300, '')],
      build: c => [{ type: 'gaussian', props: { blur: i => c.p.amount * c.k * c.env(i), repeat: true } }]
    },
    {
      id: 'blur-directional', name: _T('Flou directionnel'), cat: 'blur', frames: 8, curve: 'easeIn',
      desc: _T('Traînée de flou dans une direction.'),
      params: [range('amount', _T('Longueur'), 80, 0, 300, ''), range('angle', 'Direction', 90, 0, 360, '°')],
      build: c => [{ type: 'directional', props: { direction: c.p.angle, length: i => c.p.amount * c.k * c.env(i) } }]
    },

    // ---------------------------------------------------------------- zooms
    {
      id: 'zoom-in', name: 'Zoom in', cat: 'zoom', frames: 8, curve: 'expoIn',
      desc: _T('Zoom avant avec flou de mouvement réel (Transformer).'),
      params: [range('amount', 'Zoom', 50, 0, 300, '%'), MBLUR(270)],
      build: c => [{ type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * c.env(i) }) }]
    },
    {
      id: 'zoom-out', name: 'Zoom out', cat: 'zoom', frames: 8, curve: 'expoIn',
      desc: _T('Zoom arrière. Au-delà de ~20 % les bords noirs apparaissent.'),
      params: [range('amount', 'Zoom', 20, 0, 80, '%'), MBLUR(270)],
      build: c => [{ type: 'transform', props: transformBlur(c, { scale: i => 100 - Math.min(90, c.p.amount * c.k * c.env(i)) }) }]
    },
    {
      id: 'zoom-bounce', name: _T('Zoom rebond'), cat: 'zoom', frames: 12, noCurve: true,
      desc: _T('Punch de zoom avec rebond amorti.'),
      params: [range('amount', 'Zoom', 30, 0, 150, '%'), range('bounces', _T('Rebonds'), 2, 1, 5, ''), MBLUR(200)],
      build: c => {
        const v = i => { const u = 1 - c.tp(i); const s = (1 - u) * Math.exp(-3 * u) * Math.cos(Math.PI * c.p.bounces * u); return s < 0 ? s * 0.5 : s; };
        return [{ type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * v(i) }) }];
      }
    },
    {
      id: 'zoom-spin', name: 'Zoom rotation', cat: 'zoom', frames: 10, curve: 'expoIn',
      desc: _T('Zoom et rotation enchaînés à travers la coupe.'),
      params: [range('amount', 'Zoom', 40, 0, 200, '%'), range('angle', 'Rotation', 90, 0, 360, '°'),
        select('sens', _T('Sens'), 'cw', [{ v: 'cw', label: _T('Horaire') }, { v: 'ccw', label: _T('Anti-horaire') }]), MBLUR(300)],
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
      desc: _T('Tremblement caméra avec zoom de compensation.'),
      params: [range('amount', 'Amplitude', 3, 0, 20, '%', 0.5), range('freq', _T('Fréquence'), 55, 1, 100, '%'), range('rotation', 'Rotation', 2, 0, 20, '°', 0.5),
        select('axis', 'Axes', 'xy', [{ v: 'xy', label: 'X + Y' }, { v: 'x', label: 'X' }, { v: 'y', label: 'Y' }]), MBLUR(180), SEED],
      build: c => shake(c)
    },
    {
      id: 'shake-impact', name: 'Impact', cat: 'shake', frames: 10, curve: 'expoIn',
      desc: _T('Choc violent : shake, punch de zoom et flou.'),
      params: [range('amount', 'Amplitude', 6, 0, 20, '%', 0.5), range('freq', _T('Fréquence'), 75, 1, 100, '%'), range('rotation', 'Rotation', 4, 0, 20, '°', 0.5),
        select('axis', 'Axes', 'xy', [{ v: 'xy', label: 'X + Y' }, { v: 'x', label: 'X' }, { v: 'y', label: 'Y' }]), MBLUR(240), SEED],
      build: c => shake(c, { punch: 10, blur: 8 })
    },
    {
      id: 'shake-bass', name: 'Bass drop', cat: 'shake', frames: 8, curve: 'expoIn',
      desc: _T('Secousse verticale serrée, idéale sur un kick.'),
      params: [range('amount', 'Amplitude', 4, 0, 20, '%', 0.5), range('freq', _T('Fréquence'), 95, 1, 100, '%'), range('rotation', 'Rotation', 0, 0, 20, '°', 0.5),
        select('axis', 'Axes', 'y', [{ v: 'xy', label: 'X + Y' }, { v: 'x', label: 'X' }, { v: 'y', label: 'Y' }]), MBLUR(180), SEED],
      build: c => shake(c)
    },

    // ---------------------------------------------------------------- slides
    {
      id: 'slide', name: 'Slide', cat: 'slide', frames: 8, curve: 'expoIn',
      desc: _T('Glissement de l\'image (bords répétés) avec flou directionnel.'),
      params: [select('dir', 'Direction', 'left', DIR_OPTIONS), range('distance', 'Distance', 60, 0, 100, '%'), range('blur', _T('Flou'), 120, 0, 300, '')],
      build: c => slide(c)
    },
    {
      id: 'whip-pan', name: 'Whip pan', cat: 'slide', frames: 6, curve: 'expoIn',
      desc: _T('Panoramique filé très rapide.'),
      params: [select('dir', 'Direction', 'left', DIR_OPTIONS), range('distance', 'Distance', 100, 0, 100, '%'), range('blur', _T('Flou'), 260, 0, 400, ''), MBLUR(180)],
      build: c => slide(c, { punch: 6 })
    },

    // ---------------------------------------------------------------- distortions
    {
      id: 'wave', name: _T('Onde'), cat: 'distort', frames: 10, curve: 'easeIn',
      desc: _T('Ondulation de l\'image (Déformation de la vague).'),
      params: [range('amount', _T('Hauteur'), 25, 0, 100, ''), range('width', _T('Largeur'), 60, 1, 200, '')],
      build: c => [{ type: 'wave', props: { height: i => c.p.amount * c.k * c.env(i), width: c.p.width } }]
    },
    {
      id: 'lens', name: 'Bulge', cat: 'distort', frames: 8, curve: 'easeIn',
      desc: _T('Bombement d\'objectif.'),
      params: [range('amount', _T('Courbure'), -45, -100, 100, '')],
      build: c => [{ type: 'lens', props: { curvature: i => c.p.amount * c.k * c.env(i) } }]
    },
    {
      id: 'glitch', name: 'Glitch', cat: 'distort', frames: 10, curve: 'easeIn',
      desc: _T('Sauts d\'image, ondes et pics de luminosité aléatoires.'),
      params: [range('density', _T('Densité'), 50, 5, 100, '%'), SEED],
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

    // ---------------------------------------------------------------- transitions douces et modernes
    {
      id: 'push', name: 'Push', cat: 'slide', frames: 10, curve: 'easeInOut',
      desc: _T('Les deux plans glissent ensemble, propre et moderne (présentations, contenus de marque).'),
      params: [select('dir', 'Direction', 'left', DIR_OPTIONS), range('distance', 'Distance', 100, 0, 100, '%'), range('blur', _T('Flou'), 50, 0, 300, '')],
      build: c => slide(c)
    },
    {
      id: 'zoom-smooth', name: _T('Zoom doux'), cat: 'zoom', frames: 12, curve: 'easeInOut',
      desc: _T('Zoom avant fluide et discret à travers la coupe.'),
      params: [range('amount', 'Zoom', 22, 0, 100, '%'), MBLUR(150)],
      build: c => [{ type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * c.env(i) }) }]
    },
    {
      id: 'zoom-through', name: _T('Zoom traversant'), cat: 'zoom', frames: 8, curve: 'expoIn',
      desc: _T('On plonge dans l\'image : gros zoom flou qui traverse la coupe.'),
      params: [range('amount', 'Zoom', 160, 0, 400, '%'), range('blur', _T('Flou'), 35, 0, 150, ''), MBLUR(300)],
      build: c => [
        { type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * c.env(i) }) },
        { type: 'gaussian', props: { blur: i => c.p.blur * c.k * c.env(i), repeat: true } }
      ]
    },
    {
      id: 'pop-in', name: 'Pop', cat: 'zoom', frames: 8, noCurve: true,
      desc: _T('Le plan arrive avec un petit rebond d\'échelle, très « réseaux sociaux ».'),
      params: [range('amount', _T('Rebond'), 12, 0, 40, '%')],
      build: c => {
        // Côté POST : de petit à normal avec dépassement ; côté PRE : léger rétrécissement.
        const shown = i => (c.side === 'post' ? backOut(1 - c.tp(i)) : 1 - c.tp(i) * c.tp(i) * 0.5);
        return [{ type: 'transform', props: { scale: i => 100 - c.p.amount * c.k * (1 - shown(i)) } }];
      }
    },
    {
      id: 'fade-white', name: _T('Fondu lumineux'), cat: 'flash', frames: 14, curve: 'easeInOut',
      desc: _T('Fondu doux vers le blanc, élégant (mariages, aftermovies, films de marque).'),
      params: [range('glow', 'Halo', 20, 0, 100, '%')],
      build: c => {
        const fx = [{ type: 'bc', props: { brightness: i => Math.min(100, 85 * c.k * c.env(i)), contrast: i => -30 * c.k * c.env(i) } }];
        if (c.p.glow > 0) fx.push({ type: 'gaussian', props: { blur: i => c.p.glow * 0.6 * c.k * c.env(i), repeat: true } });
        return fx;
      }
    },
    {
      id: 'fade-black', name: _T('Fondu au noir'), cat: 'flash', frames: 16, curve: 'easeInOut',
      desc: _T('Fondu au noir posé, pour changer de partie ou de lieu.'),
      params: [],
      build: c => [{ type: 'transform', props: { opacity: i => c.clamp(100 - 100 * c.k * c.env(i), 0, 100) } }]
    },
    {
      id: 'blur-dissolve', name: _T('Flou fondu'), cat: 'blur', frames: 12, curve: 'easeInOut',
      desc: _T('Le plan se floute puis le suivant se précise : transition douce et sobre.'),
      params: [range('amount', _T('Flou'), 45, 0, 200, ''), range('fade', _T('Assombrir'), 15, 0, 60, '%')],
      build: c => [
        { type: 'gaussian', props: { blur: i => c.p.amount * c.k * c.env(i), repeat: true } },
        { type: 'bc', props: { brightness: i => -c.p.fade * c.k * c.env(i) } }
      ]
    },

    // ---------------------------------------------------------------- mouvements sur tout le plan
    {
      id: 'punch-in', name: 'Punch-in', cat: 'motion', frames: 25, noCurve: true,
      desc: _T('Recadrage serré instantané pour masquer un jump cut. Pose-le en « Clips entiers » sur un plan sur deux.'),
      params: [range('amount', 'Zoom', 15, 0, 60, '%'), select('frame', _T('Cadrage'), 'center', [{ v: 'center', label: _T('Centre') }, { v: 'up', label: _T('Visage (haut)') }])],
      build: c => [{ type: 'transform', props: { scale: 100 + c.p.amount * c.k, position: c.p.frame === 'up' ? [0.5, 0.5 + c.p.amount * c.k / 400] : [0.5, 0.5] } }]
    },
    {
      id: 'face-zoom', name: 'Zoom visage', cat: 'motion', frames: 100, noCurve: true, face: true, sparse: true,
      desc: _T('Face cam, interview : RR FX trouve le visage et zoome sur les yeux en les suivant. Ils restent à leur place à l\'écran, ou recentrés.'),
      params: [range('amount', 'Zoom', 20, 0, 80, '%')].concat(FACE_PARAMS, [select('arrive', _T('Arrivée'), 'cut', [{ v: 'cut', label: _T('Sèche') }, { v: 'smooth', label: _T('Douce') }])]),
      build: c => {
        // Arrivée douce : le zoom s'installe sur les 8 premières images.
        const grow = i => (c.p.arrive === 'smooth' ? 1 - Math.pow(1 - Math.min(1, i / 8), 3) : 1);
        return faceZoom(c, grow);
      }
    },
    {
      id: 'face-push', name: _T('Zoom visage progressif'), cat: 'motion', frames: 100, noCurve: true, face: true, sparse: true,
      desc: _T('Zoom avant lent sur tout le plan, centré sur les yeux qui sont suivis : l\'émotion monte sans perdre le regard.'),
      params: [range('amount', 'Zoom', 15, 0, 60, '%')].concat(FACE_PARAMS),
      build: c => faceZoom(c, i => (c.N <= 1 ? 1 : i / (c.N - 1)))
    },
    {
      id: 'face-stab', name: _T('Stabiliser le visage'), cat: 'motion', frames: 100, noCurve: true, face: true, sparse: true,
      desc: _T('Face cam : la tête reste au même endroit du cadre même si la personne bouge. Léger zoom pour ne jamais voir de bord.'),
      params: [range('amount', 'Zoom', 8, 2, 30, '%'), select('follow', _T('Suivi'), 'tight', [{ v: 'tight', label: _T('Serré') }, { v: 'smooth', label: _T('Doux') }])],
      build: c => faceZoom(Object.assign({}, c, { p: Object.assign({}, c.p, { frame: 'lock' }) }), () => 1)
    },
    {
      id: 'object-zoom', name: _T('Zoom suivi (objet)'), cat: 'motion', frames: 100, noCurve: true, face: true, track: 'object', sparse: true,
      desc: _T('Entoure un produit, un logo ou une personne sur la première image : RR FX le suit et zoome dessus pendant tout le plan.'),
      params: [range('amount', 'Zoom', 25, 0, 100, '%'), select('frame', _T('Objet'), 'keep', [{ v: 'keep', label: _T('À sa place') }, { v: 'center', label: _T('Recentré') }]),
        select('follow', _T('Suivi'), 'smooth', [{ v: 'smooth', label: _T('Doux') }, { v: 'tight', label: _T('Serré') }]), select('arrive', _T('Arrivée'), 'smooth', [{ v: 'cut', label: _T('Sèche') }, { v: 'smooth', label: _T('Douce') }])],
      build: c => faceZoom(c, i => (c.p.arrive === 'smooth' ? 1 - Math.pow(1 - Math.min(1, i / 8), 3) : 1))
    },
    {
      id: 'ken-burns', name: 'Ken Burns', cat: 'motion', frames: 100, noCurve: true,
      desc: _T('Zoom et panoramique lents sur tout le plan : idéal pour les photos (diaporamas, mariages, souvenirs).'),
      params: [range('amount', 'Zoom', 12, 0, 50, '%'), select('dir', _T('Panoramique'), 'none', [{ v: 'none', label: _T('Aucun') }].concat(DIR_OPTIONS)), select('way', _T('Sens'), 'in', [{ v: 'in', label: _T('Avant') }, { v: 'out', label: _T('Arrière') }])],
      build: c => {
        // Progression sur toute la durée, quel que soit le côté.
        const t = i => (c.N <= 1 ? 1 : i / (c.N - 1));
        const z = i => (c.p.way === 'out' ? 1 - t(i) : t(i));
        const d = DIRS[c.p.dir] || [0, 0], pan = c.p.amount / 100 * 0.35 * c.k;
        return [{ type: 'transform', props: transformBlur(c, { scale: i => 100 + c.p.amount * c.k * z(i), position: i => [0.5 + d[0] * pan * (t(i) - 0.5), 0.5 + d[1] * pan * (t(i) - 0.5)] }) }];
      }
    },
    {
      id: 'breathe', name: _T('Zoom lent'), cat: 'motion', frames: 100, noCurve: true,
      desc: _T('Zoom avant très lent sur tout le plan : une interview ou un face caméra prend vie.'),
      params: [range('amount', 'Zoom', 6, 0, 30, '%')],
      build: c => [{ type: 'transform', props: { scale: i => 100 + c.p.amount * c.k * (c.N <= 1 ? 1 : i / (c.N - 1)) } }]
    },
    {
      id: 'handheld', name: _T('Caméra à l\'épaule'), cat: 'motion', frames: 100, noCurve: true,
      desc: _T('Léger flottement de caméra sur tout le plan, pour un rendu vivant et naturel.'),
      params: [range('amount', 'Amplitude', 1.2, 0, 6, '%', 0.1), range('rotation', 'Rotation', 0.6, 0, 5, '°', 0.1), SEED],
      build: c => {
        const a = c.p.amount / 100 * c.k, s = c.p.seed;
        return [{ type: 'transform', props: {
          position: i => [0.5 + a * c.noise(i * 0.045, s), 0.5 + a * c.noise(i * 0.045, s + 17)],
          rotation: i => c.p.rotation * c.k * c.noise(i * 0.035, s + 31),
          scale: 100 + c.p.amount * 2.4 * c.k
        } }];
      }
    },

    // ---------------------------------------------------------------- motion blur
    {
      id: 'echo-blur', name: 'Motion blur', cat: 'time', frames: 6, curve: 'easeIn', target: 'copy',
      desc: _T('Vrai flou de mouvement par fusion des images précédentes (Écho), sur une copie du plan posée au-dessus.'),
      params: [range('echoes', _T('Images fusionnées'), 4, 1, 10, '')],
      build: c => {
        const n = i => Math.round(c.p.echoes * c.k * c.env(i));
        return [{ type: 'echo', props: { time: -1 / c.fps, count: n, intensity: i => Math.round(1000 / (n(i) + 1)) / 1000, decay: 1 } }];
      }
    }
  ];

  // ---------------------------------------------------------------- animations de texte
  // Entrée = côté POST (de l'état caché à l'état normal), sortie = côté PRE.
  const TITLE_ANIMS = [
    { id: 'fade', name: _T('Fondu'), frames: 6, curve: 'easeInOut', params: [],
      build: c => [{ type: 'transform', props: { opacity: i => 100 - 100 * c.env(i) } }] },
    { id: 'pop', name: 'Pop', frames: 7, noCurve: true, params: [range('amount', _T('Rebond'), 100, 0, 200, '%')],
      build: c => {
        // Progression vers l'état normal : 1 = visible ; avec un léger dépassement à l'entrée.
        const shown = i => (c.side === 'post' ? backOut(1 - c.tp(i)) : 1 - c.tp(i) * c.tp(i));
        const k = c.p.amount / 100;
        const scale = i => { const v = shown(i); return 100 * Math.max(0, v > 1 ? 1 + (v - 1) * k : v); };
        return [{ type: 'transform', props: { scale, opacity: i => c.clamp(100 * Math.min(1, shown(i) * 2), 0, 100) } }];
      } },
    { id: 'zoom-blur', name: _T('Zoom flou'), frames: 8, curve: 'expoIn', params: [range('amount', 'Zoom', 30, 0, 150, '%'), range('blur', _T('Flou'), 30, 0, 150, '')],
      build: c => [
        { type: 'transform', props: { scale: i => 100 + c.p.amount * c.env(i), opacity: i => 100 - 100 * c.env(i), compShutter: false, shutter: 180 } },
        { type: 'gaussian', props: { blur: i => c.p.blur * c.env(i), repeat: true } }
      ] },
    { id: 'slide-up', name: _T('Glissement'), frames: 8, curve: 'expoIn', params: [select('dir', _T('Depuis'), 'down', [{ v: 'down', label: '↑' }, { v: 'up', label: '↓' }, { v: 'left', label: '→' }, { v: 'right', label: '←' }]), range('distance', 'Distance', 8, 0, 50, '%')],
      build: c => {
        const d = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[c.p.dir] || [0, 1], D = c.p.distance / 100;
        return [
          { type: 'transform', props: { position: i => [0.5 + d[0] * D * c.env(i), 0.5 + d[1] * D * c.env(i)], opacity: i => 100 - 100 * c.env(i), compShutter: false, shutter: 180 } },
          { type: 'directional', props: { direction: d[0] ? 90 : 0, length: i => 60 * c.vel(i) * c.env(i) } }
        ];
      } },
    { id: 'blur', name: _T('Flou'), frames: 8, curve: 'easeInOut', params: [range('blur', _T('Flou'), 40, 0, 200, '')],
      build: c => [
        { type: 'gaussian', props: { blur: i => c.p.blur * c.env(i), repeat: true } },
        { type: 'transform', props: { opacity: i => 100 - 100 * c.env(i) } }
      ] },
    { id: 'impact', name: 'Impact', frames: 8, curve: 'expoIn', params: [range('amount', _T('Secousse'), 3, 0, 15, '%', 0.5)],
      build: c => [{ type: 'transform', props: {
        scale: i => 100 + 18 * c.env(i),
        position: i => [0.5 + c.p.amount / 100 * c.env(i) * c.noise(i * 0.8, 3), 0.5 + c.p.amount / 100 * c.env(i) * c.noise(i * 0.8, 9)],
        opacity: i => c.side === 'post' ? 100 : 100 - 100 * c.env(i),
        compShutter: false, shutter: 220
      } }] },
    { id: 'none', name: _T('Aucune'), frames: 0, params: [], build: () => [] }
  ];

  const byId = {};
  EFFECTS.forEach(e => { byId[e.id] = e; });

  const titleById = {};
  TITLE_ANIMS.forEach(a => { titleById[a.id] = a; });

  return { CATEGORIES, EFFECTS, byId, TITLE_ANIMS, titleById };
});
