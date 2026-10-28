/* Courbes, compilation des effets, rampes, effets capturés, détection des noms. */
const { test } = require('node:test');
const assert = require('node:assert');
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');

const finite = v => (Array.isArray(v) ? v.every(Number.isFinite) : typeof v === 'boolean' || Number.isFinite(v));

test('bezier presets go from 0 to 1 and stay monotone', () => {
  Object.keys(Core.CURVE_PRESETS).forEach(k => {
    const c = Core.CURVE_PRESETS[k].v, f = Core.bezier(c[0], c[1], c[2], c[3]);
    assert.strictEqual(f(0), 0);
    assert.strictEqual(f(1), 1);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.01) { const y = f(x); assert.ok(y >= prev - 1e-9, k + ' at ' + x); prev = y; }
  });
});

test('every built-in effect compiles to finite, in-range values for any duration', () => {
  const ranges = {
    'transform.opacity': [0, 100], 'transform.shutter': [0, 360], 'transform.scale': [1, 500],
    'bc.brightness': [-100, 100], 'bc.contrast': [-100, 100], 'gaussian.blur': [0, 1000],
    'directional.length': [0, 1000], 'echo.count': [0, 20], 'echo.intensity': [0, 1]
  };
  Lib.EFFECTS.forEach(def => {
    ['pre', 'post'].forEach(side => {
      [1, 2, 3, 8, 25, 120].forEach(N => {
        const spec = Core.compileEffect(def, { intensity: 200 }, side, N, 25);
        assert.ok(spec.length, def.id + ' produces effects');
        spec.forEach(fx => fx.props.forEach(p => {
          const vals = p.values || [p.static];
          if (p.values) assert.strictEqual(p.values.length, N, def.id + ' ' + p.key + ' length');
          vals.forEach(v => {
            assert.ok(finite(v), def.id + ' ' + p.key + ' finite');
            const r = ranges[fx.type + '.' + p.key];
            if (r && typeof v === 'number') assert.ok(v >= r[0] - 1e-9 && v <= r[1] + 1e-9, def.id + ' ' + p.key + ' = ' + v);
          });
        }));
      });
    });
  });
});

test('PRE peaks at the cut, POST starts at the peak (mirror)', () => {
  const def = Lib.byId['zoom-in'];
  const pre = Core.compileEffect(def, {}, 'pre', 8, 25)[0].props.find(p => p.key === 'scale').values;
  const post = Core.compileEffect(def, {}, 'post', 8, 25)[0].props.find(p => p.key === 'scale').values;
  assert.strictEqual(pre[7], 150);
  assert.strictEqual(pre[0], 100);
  assert.deepStrictEqual(post, pre.slice().reverse());
});

test('built-in recipes only use registry properties, with a name check', () => {
  Lib.EFFECTS.forEach(def => {
    Core.compileEffect(def, {}, 'pre', 6, 25).forEach(fx => fx.props.forEach(p => {
      assert.strictEqual(Core.REGISTRY[fx.type].props[p.key], p.index);
      if (['uniform', 'skew', 'skewAxis', 'anchor', 'scaleW', 'dims', 'type', 'speed', 'direction'].indexOf(p.key) < 0 || fx.type === 'directional') {
        assert.ok(p.match, def.id + ' ' + fx.type + '.' + p.key + ' has a name check');
      }
    }));
  });
});

test('name checks accept the expected parameter names (EN / FR) and reject neighbours', () => {
  const ok = (type, key, name) => {
    const m = Core.REGISTRY[type].match[key];
    return new RegExp(m[0], 'i').test(name) && !(m[1] && new RegExp(m[1], 'i').test(name));
  };
  assert.ok(ok('transform', 'scale', 'Scale'));
  assert.ok(ok('transform', 'scale', 'Hauteur d\'échelle'));
  assert.ok(!ok('transform', 'scale', 'Échelle uniforme'));
  assert.ok(!ok('transform', 'scale', 'Scale Width'));
  assert.ok(ok('transform', 'shutter', 'Shutter Angle'));
  assert.ok(ok('transform', 'shutter', 'Angle d\'obturateur'));
  assert.ok(!ok('transform', 'shutter', 'Use Composition\'s Shutter Angle'));
  assert.ok(ok('transform', 'compShutter', 'Utiliser l\'angle d\'obturateur de la composition'));
  assert.ok(ok('gaussian', 'blur', 'Blurriness'));
  assert.ok(ok('gaussian', 'blur', 'Flou'));
  assert.ok(!ok('gaussian', 'blur', 'Blur Dimensions'));
  assert.ok(ok('gaussian', 'repeat', 'Répéter les pixels du bord'));
  assert.ok(ok('directional', 'length', 'Longueur du flou'));
  assert.ok(!ok('directional', 'direction', 'Blur Length'));
  assert.ok(ok('bc', 'brightness', 'Luminosité'));
  assert.ok(!ok('bc', 'brightness', 'Contraste'));
  assert.ok(ok('offset', 'center', 'Shift Center To'));
  assert.ok(ok('offset', 'center', 'Décaler le centre vers'));
  assert.ok(!ok('offset', 'center', 'Fusionner avec l\'original'));
  assert.ok(ok('echo', 'count', 'Number Of Echoes'));
  assert.ok(!ok('echo', 'time', 'Number Of Echoes'));
});

test('effect names are detected in French, English and German lists', () => {
  const fr = Core.resolveEffectNames(['Transformer', 'Flou gaussien', 'Flou directionnel', 'Luminosité et contraste', 'Décalage', 'Déformation de la vague', 'Distorsion de l’objectif', 'Écho', 'Flou de l’appareil photo']);
  assert.deepStrictEqual(Object.values(fr).filter(v => !v), []);
  assert.strictEqual(fr.lens, 'Distorsion de l’objectif');
  const en = Core.resolveEffectNames(['Transform', 'Gaussian Blur', 'Directional Blur', 'Brightness & Contrast', 'Offset', 'Wave Warp', 'Lens Distortion', 'Echo', 'Camera Blur']);
  assert.deepStrictEqual(Object.values(en).filter(v => !v), []);
  const de = Core.resolveEffectNames(['Transformieren', 'Gaußscher Weichzeichner', 'Direktionaler Weichzeichner', 'Helligkeit und Kontrast', 'Versatz', 'Wellen-Warp', 'Objektivverzerrung', 'Echo']);
  assert.deepStrictEqual(Object.values(de).filter(v => !v), []);
  const none = Core.resolveEffectNames([]);
  assert.strictEqual(none.transform, null);
});

test('settings overrides: names first, a hand-set index disables the name check', () => {
  const r = Core.mergeRegistry({ wave: { names: ['Mon onde'], props: { height: 5 } } }, { wave: 'Déformation de la vague' });
  assert.deepStrictEqual(r.wave.names.slice(0, 2), ['Mon onde', 'Déformation de la vague']);
  assert.strictEqual(r.wave.props.height, 5);
  assert.strictEqual(r.wave.match.height, undefined);
  assert.ok(r.wave.match.width);
  assert.ok(Core.REGISTRY.wave.match.height, 'the shared registry is not modified');
  assert.doesNotThrow(() => Core.mergeRegistry('nonsense'));
  assert.doesNotThrow(() => Core.mergeRegistry({ wave: null, x: { names: 'a' } }));
});

test('wire format keeps only useful keyframes and the same timing', () => {
  assert.deepStrictEqual(Core.keysFromValues([1, 1, 1, 2, 2, 2, 2, 3]), [[0, 1], [2, 1], [3, 2], [6, 2], [7, 3]]);
  assert.deepStrictEqual(Core.keysFromValues([5]), [[0, 5]]);
  assert.deepStrictEqual(Core.keysFromValues([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]), [[0, [0.5, 0.5]], [2, [0.5, 0.5]]]);
  const spec = Core.compileEffect(Lib.byId.flicker, {}, 'pre', 30, 25);
  const wire = Core.toWire(spec);
  const full = spec[0].props.find(p => p.values).values;
  const keys = wire[0].props.find(p => p.keys).keys;
  // Linear interpolation of the kept keys gives back every frame.
  for (let i = 0; i < full.length; i++) {
    const a = keys.filter(k => k[0] <= i).pop(), b = keys.find(k => k[0] >= i);
    const v = a[0] === b[0] ? a[1] : a[1] + (b[1] - a[1]) * (i - a[0]) / (b[0] - a[0]);
    assert.ok(Math.abs(v - full[i]) < 1e-9, 'frame ' + i);
  }
});

test('captured effects: stretch, align, mirror', () => {
  const cap = { origin: 'post', frames: 4, components: [{ matchName: 'AE.ADBE Geometry2', displayName: 'Transform', props: [{ index: 3, values: [200, 150, 120, 100] }, { index: 10, static: 180 }] }] };
  const post = Core.compileCaptured(cap, 'post', 4);
  assert.deepStrictEqual(post[0].props[0].values, [200, 150, 120, 100]);
  assert.strictEqual(post[0].props[0].key, 'scale');
  const pre = Core.compileCaptured(cap, 'pre', 4);
  assert.deepStrictEqual(pre[0].props[0].values, [100, 120, 150, 200]);
  const noMirror = Core.compileCaptured(cap, 'pre', 4, { mirror: false });
  assert.deepStrictEqual(noMirror[0].props[0].values, [200, 150, 120, 100]);
  const stretched = Core.compileCaptured(cap, 'post', 7);
  assert.strictEqual(stretched[0].props[0].values.length, 7);
  assert.strictEqual(stretched[0].props[0].values[0], 200);
  assert.strictEqual(stretched[0].props[0].values[6], 100);
  const cropped = Core.compileCaptured(cap, 'post', 2, { stretch: false });
  assert.deepStrictEqual(cropped[0].props[0].values, [200, 150]);
  assert.strictEqual(Core.compileCaptured(cap, 'post', 1)[0].props[0].values, undefined, 'one frame = static');
});

test('ramp pieces cover every frame and follow the curve', () => {
  Object.keys(Core.RAMP_PRESETS).forEach(k => {
    [2, 7, 12, 60].forEach(N => {
      [1, 4, 10, 32].forEach(K => {
        const pieces = Core.rampPieces(Core.RAMP_PRESETS[k].points, N, K);
        assert.strictEqual(pieces.reduce((s, p) => s + p.frames, 0), N);
        assert.ok(pieces.length <= N);
        pieces.forEach(p => { assert.ok(p.frames >= 1); assert.ok(p.speed >= 1 && p.speed <= 1000, k + ' ' + p.speed); });
      });
    });
  });
  const up = Core.rampPieces(Core.RAMP_PRESETS.intoCut.points, 12, 6);
  for (let i = 1; i < up.length; i++) assert.ok(up[i].speed >= up[i - 1].speed);
  assert.strictEqual(Core.rampSourceFrames([{ frames: 4, speed: 200 }, { frames: 2, speed: 50 }]), 9);
});

test('ramp curve never overshoots between points (monotone)', () => {
  const f = Core.rampFunction([{ t: 0, v: 100 }, { t: 0.5, v: 400 }, { t: 0.6, v: 400 }, { t: 1, v: 100 }]);
  for (let t = 0; t <= 1; t += 0.005) assert.ok(f(t) <= 400.0001 && f(t) >= 99.999, 't=' + t + ' ' + f(t));
  assert.strictEqual(Core.rampFunction([])(0.5), 100);
});
