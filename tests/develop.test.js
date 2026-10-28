/* Moteur couleur façon Lightroom : réglages, courbes, LUT, et DCTL compilé en C comparé au calcul JS. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('../plugin/js/develop.js');
const A = require('../plugin/js/assets.js');

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const colors = n => Array.from({ length: n }, () => [rnd(), rnd(), rnd()]).concat([[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.9, 0.6, 0.45]]);
const maxDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const lin = v => (v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45));

// Des réglages au hasard sur tous les panneaux.
function randomParams() {
  const p = D.defaults(), s = () => Math.round((rnd() * 2 - 1) * 100);
  ['temp', 'tint', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation', 'pHighlights', 'pLights', 'pDarks', 'pShadows', 'balance', 'shadowTint', 'redHue', 'redSat', 'greenHue', 'greenSat', 'blueHue', 'blueSat'].forEach(k => { p[k] = s(); });
  p.exposure = Math.round((rnd() * 4 - 2) * 100) / 100;
  p.blending = Math.round(rnd() * 100);
  p.amount = 60 + Math.round(rnd() * 40);
  D.BANDS.forEach(b => { p.hsl[b.id] = { h: s(), s: s(), l: s() }; });
  D.WHEELS.forEach(w => { p.grading[w] = { h: Math.round(rnd() * 360), s: Math.round(rnd() * 100), l: s() }; });
  p.curve.rgb = [[0, 0.05], [0.4, 0.35], [0.7, 0.8], [1, 0.97]];
  p.curve.b = [[0, 0.1], [1, 0.9]];
  return p;
}

test('default settings leave the image unchanged', () => {
  const f = D.compile(D.defaults());
  colors(300).forEach(c => assert.ok(maxDiff(f(...c), c) < 1e-3, c + ' → ' + f(...c)));
  assert.deepStrictEqual(D.normalize({ exposure: 'x', hsl: { red: { s: 20 } }, curve: { rgb: [[1, 1], [0, 0.1]] } }).hsl.red, { h: 0, s: 20, l: 0 });
  assert.deepStrictEqual(D.normalize({ curve: { rgb: [[1, 1], [0, 0.1]] } }).curve.rgb, [[0, 0.1], [1, 1]], 'points sorted');
});

test('white balance and exposure work in linear light', () => {
  const up = D.compile({ exposure: 1 })(0.5, 0.5, 0.5), base = lin(0.5);
  assert.ok(Math.abs(lin(up[0]) - 2 * base) < 2e-3, 'one stop = twice the light');
  const warm = D.compile({ temp: 60 })(0.5, 0.5, 0.5);
  assert.ok(warm[0] > warm[1] && warm[1] > warm[2], 'warmer = more red, less blue');
  const magenta = D.compile({ tint: 60 })(0.5, 0.5, 0.5);
  assert.ok(magenta[1] < magenta[0] && magenta[1] < magenta[2], 'tint + = magenta');
});

test('tone sliders: expected direction, never inverted (monotonic)', () => {
  const at = (p, x) => D.compile(p)(x, x, x)[0];
  assert.ok(at({ shadows: 100 }, 0.2) > 0.21 && Math.abs(at({ shadows: 100 }, 0.95) - 0.95) < 0.02, 'shadows lift the darks only');
  assert.ok(at({ highlights: -100 }, 0.8) < 0.79 && Math.abs(at({ highlights: -100 }, 0.05) - 0.05) < 0.02, 'highlights pull the brights only');
  assert.ok(at({ contrast: 100 }, 0.25) < 0.25 && at({ contrast: 100 }, 0.75) > 0.75, 'contrast = S curve');
  assert.ok(at({ blacks: -100 }, 0.05) < 0.03, 'blacks crush');
  for (let k = 0; k < 60; k++) {
    const p = randomParams();
    // Séparations de la courbe paramétrique rapprochées : le cas le plus difficile.
    if (k % 3 === 0) { p.split1 = 8; p.split2 = 12; p.split3 = 90; }
    let last = -1;
    for (let i = 0; i <= 200; i++) {
      const v = D.tone(i / 200, D.normalize(p));
      assert.ok(v >= last - 1e-9, 'monotonic tone curve');
      last = v;
    }
  }
});

test('color mixer only touches its colors; grading tints the right tones', () => {
  const f = D.compile({ hsl: { red: { h: 0, s: -100, l: 0 } } });
  const red = f(0.8, 0.1, 0.1), blue = f(0.1, 0.2, 0.8);
  assert.ok(Math.abs(red[0] - red[1]) < 0.02, 'red becomes gray');
  assert.ok(maxDiff(blue, [0.1, 0.2, 0.8]) < 1e-3, 'blue untouched');
  const hue = D.compile({ hsl: { yellow: { h: 100, s: 0, l: 0 } } })(0.8, 0.8, 0.1);
  assert.ok(hue[1] > hue[0], 'yellow pushed toward green');
  const g = D.compile({ grading: { shadows: { h: 220, s: 100, l: 0 } } });
  const dark = g(0.1, 0.1, 0.1), bright = g(0.95, 0.95, 0.95);
  assert.ok(dark[2] > dark[0] + 0.05, 'blue shadows');
  assert.ok(maxDiff(bright, [0.95, 0.95, 0.95]) < 0.01, 'highlights untouched');
  const bw = D.compile({ saturation: -100 })(0.9, 0.3, 0.2);
  assert.ok(Math.abs(bw[0] - bw[2]) < 1e-6, 'saturation -100 = black and white');
  const vib = D.compile({ vibrance: 100 });
  assert.ok(maxDiff(vib(0.9, 0.2, 0.2), [0.9, 0.2, 0.2]) < maxDiff(vib(0.5, 0.45, 0.4), [0.5, 0.45, 0.4]) + 0.2, 'vibrance boosts muted colors more');
});

test('point curves: monotone, through their points, per channel', () => {
  const t = D.curveTable([[0, 0], [0.25, 0.4], [0.75, 0.6], [1, 1]]);
  for (let i = 1; i < 256; i++) assert.ok(t[i] >= t[i - 1] - 1e-7);
  assert.ok(Math.abs(t[Math.round(0.25 * 255)] - 0.4) < 0.01);
  const f = D.compile({ curve: { b: [[0, 0.2], [1, 0.8]] } });
  const c = f(0, 0, 0);
  assert.ok(c[2] > 0.19 && c[0] < 0.01, 'blue lifted alone');
});

test('LUT .cube: same result as the engine, readable by Premiere and the Ressources tab', () => {
  const p = randomParams(), cube = D.toCube(D.buildLut(p, 33), 'Mon "look"');
  assert.match(cube, /LUT_3D_SIZE 33/);
  assert.match(cube, /TITLE "Mon 'look'"/);
  assert.strictEqual(A.parseCube(cube).data.length, 33 * 33 * 33 * 3);
  // Écart LUT / calcul exact : petit en moyenne même avec des réglages extrêmes, et partout
  // petit avec les looks réalistes.
  const errors = params => {
    const lut = A.parseCube(D.toCube(D.buildLut(params, 33))), f = D.compile(params);
    return colors(300).map(c => {
      const q = c.map(v => Math.round(v * 255) / 255), px = new Uint8ClampedArray([q[0] * 255, q[1] * 255, q[2] * 255, 255]);
      A.applyLut(px, lut);
      return maxDiff([px[0] / 255, px[1] / 255, px[2] / 255], f(...q));
    });
  };
  const e = errors(p), mean = e.reduce((a, b) => a + b, 0) / e.length;
  assert.ok(mean < 0.012, 'mean error with extreme settings ' + mean.toFixed(4));
  D.LOOKS.forEach(l => { const worst = Math.max(...errors(l.p)); assert.ok(worst < 0.03, l.id + ' worst ' + worst.toFixed(3)); });
});

test('every look compiles and stays in range', () => {
  assert.ok(D.LOOKS.length >= 6);
  D.LOOKS.forEach(l => {
    const f = D.compile(l.p);
    colors(50).forEach(c => f(...c).forEach(v => assert.ok(v >= 0 && v <= 1 && isFinite(v), l.id)));
    assert.ok(maxDiff(f(0.6, 0.4, 0.3), [0.6, 0.4, 0.3]) > 0.01, l.id + ' changes something');
  });
});

let cc = null;
try { execFileSync('cc', ['--version']); cc = 'cc'; } catch (e) { cc = null; }

test('DCTL: compiles as C and gives the same colors as the panel (random settings and every look)', { skip: !cc && 'pas de compilateur C' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrfx-dctl-'));
  try {
    const cases = [D.defaults(), randomParams(), randomParams(), randomParams()].concat(D.LOOKS.map(l => D.normalize(l.p)));
    cases.forEach((p, k) => {
      const dctl = D.toDCTL(p, 'Été « test » ' + k);
      assert.match(dctl, /DEFINE_UI_PARAMS\(temp, Temperature, DCTLUI_SLIDER_FLOAT, /);
      assert.ok(D.sliderList().length <= 64, 'sliders');
      assert.ok(/^[\x00-\x7f]*$/.test(dctl), 'whole DCTL in ASCII');
      const src = path.join(dir, 'look' + k + '.c'), bin = path.join(dir, 'look' + k);
      fs.writeFileSync(src, '#include "' + path.join(__dirname, 'dctl', 'shim.h') + '"\n' + dctl + '\n#include "' + path.join(__dirname, 'dctl', 'main.c') + '"\n');
      execFileSync(cc, ['-std=c99', '-O1', '-Wall', '-Werror', '-Wno-unused-parameter', '-Wno-unused-variable', '-Wno-unused-function', '-o', bin, src, '-lm']);
      const input = colors(400);
      const out = execFileSync(bin, { input: input.map(c => c.join(' ')).join('\n') }).toString().trim().split('\n').map(l => l.split(' ').map(Number));
      const f = D.compile(p);
      let worst = 0;
      input.forEach((c, i) => { worst = Math.max(worst, maxDiff(out[i], f(...c))); });
      assert.ok(worst < 2e-3, 'case ' + k + ' : écart ' + worst);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('histogram', () => {
  const px = new Uint8ClampedArray([0, 128, 255, 255, 0, 128, 255, 255]);
  const h = D.histogram(px, 4);
  assert.ok(h.r[0] > 0 && h.b[3] > 0 && h.g[2] > 0);
});
