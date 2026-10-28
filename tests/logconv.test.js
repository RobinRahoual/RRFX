/* Conversion LOG → Rec.709 : courbes des fabricants, matrices de gamut, LUT calculée. */
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../plugin/js/logconv.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' ' + a + ' ≠ ' + b);

test('18 % grey lands on the code values the manufacturers publish', () => {
  const code = id => L.CURVES[id].encode(0.18) * 1023;
  near(code('slog3'), 420, 0.05, 'S-Log3');
  near(code('vlog'), 433, 0.5, 'V-Log');
  near(code('flog'), 470, 0.5, 'F-Log');
  near(code('logc3'), 400, 0.5, 'LogC3');
  near(L.CURVES.logc4.encode(0.18), 0.2784, 0.0005, 'LogC4');
  const ire = id => L.CURVES[id].encode(0.18) * 100;
  near(ire('clog3'), 34.3, 0.1, 'C-Log3');
  near(64 + 876 * L.CURVES.slog2.encode(0.18), 347, 0.6, 'S-Log2');
  near(ire('applelog'), 48.8, 0.1, 'Apple Log');
  // 90 % de réflectance en S-Log3 : code 598.
  near(L.CURVES.slog3.encode(0.9) * 1023, 598, 0.6, 'S-Log3 90 %');
});

test('every curve decodes what it encodes, across the whole range', () => {
  Object.keys(L.CURVES).forEach(id => {
    const c = L.CURVES[id];
    for (let x = -0.01; x < 10; x += 0.0173) {
      const back = c.decode(c.encode(x));
      assert.ok(Math.abs(back - x) <= 1e-4 * Math.max(0.05, Math.abs(x)), id + ' at ' + x + ' gives ' + back);
    }
    let prev = -Infinity;
    for (let x = 0; x < 10; x += 0.01) { const y = c.encode(x); assert.ok(y > prev, id + ' increases'); prev = y; }
  });
});

test('gamut matrices keep white and match the published Rec.2020 → Rec.709 matrix', () => {
  Object.keys(L.GAMUTS).forEach(g => {
    if (L.GAMUTS[g].w) return; // blanc Blackmagic à peine différent de D65
    L.matrix(g).forEach(r => near(r[0] + r[1] + r[2], 1, 1e-9, g + ' white'));
  });
  const ref = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];
  L.matrix('rec2020').forEach((r, i) => r.forEach((v, j) => near(v, ref[i][j], 0.0002, 'Rec.2020')));
  L.matrix('rec709').forEach((r, i) => r.forEach((v, j) => near(v, i === j ? 1 : 0, 1e-12, 'identity')));
});

test('the computed conversion gives a normal Rec.709 picture', () => {
  L.PROFILES.filter(p => !p.official).forEach(p => {
    const f = L.converter(p.id), at = x => L.fromLinear(p.id, x);
    const grey = f(at(0.18), at(0.18), at(0.18)), white = f(at(0.9), at(0.9), at(0.9)), black = f(at(0), at(0), at(0));
    grey.forEach(v => near(v, 0.409, 0.002, p.id + ' grey'));
    white.forEach(v => assert.ok(v > 0.8 && v < 0.95, p.id + ' white ' + v));
    black.forEach(v => assert.ok(v < 0.01, p.id + ' black ' + v));
    // Le blanc pur du log (code 940) n'est pas brûlé net mais reste ≤ 1.
    f(1, 1, 1).forEach(v => assert.ok(v <= 1 && v > 0.95, p.id + ' top ' + v));
  });
  // Exposition au tournage : +1 IL de surexposition corrigée = même gris.
  const f = L.converter('slog3-sg3c', { ev: 1 }), g2 = L.fromLinear('slog3-sg3c', 0.36);
  f(g2, g2, g2).forEach(v => near(v, 0.409, 0.002, 'ev'));
  // Contraste : plus doux = gris plus haut dans les ombres, épaule plus tôt.
  assert.ok(L.display(0.05, 'soft') > L.display(0.05, 'strong'));
  assert.ok(L.display(2, 'soft') < L.display(2, 'standard'));
});

test('saturated log colours stay in gamut with their hue', () => {
  const f = L.converter('slog3-sg3c');
  const out = f(0.75, 0.3, 0.3); // rouge très saturé en S-Gamut3.Cine
  out.forEach(v => assert.ok(v >= 0 && v <= 1));
  assert.ok(out[0] > out[1] && out[0] > out[2], 'still red');
});

test('LUT: size, domain, monotone neutral axis, official-only profiles refuse to compute', () => {
  const lut = L.buildLut('vlog', { size: 17 });
  assert.strictEqual(lut.size, 17);
  assert.strictEqual(lut.data.length, 17 * 17 * 17 * 3);
  let prev = -1;
  for (let i = 0; i < 17; i++) { const o = (i * 17 * 17 + i * 17 + i) * 3, v = lut.data[o]; assert.ok(v >= prev); prev = v; near(lut.data[o], lut.data[o + 1], 1e-6); }
  assert.throws(() => L.buildLut('dlogm'), /LUT du fabricant/);
  assert.ok(!L.canCompute('gplog') && L.canCompute('slog3-sg3c'));
});

test('catalogue: every brand lists known profiles, labels and search links read well', () => {
  L.BRANDS.forEach(b => b.profiles.forEach(id => assert.ok(L.profile(id), b.id + ' ' + id)));
  L.PROFILES.filter(p => !p.official).forEach(p => { assert.ok(L.CURVES[p.curve], p.id); assert.ok(L.GAMUTS[p.gamut], p.id); });
  const cam = { brand: 'sony', model: 'A7 III', profile: 'slog3-sg3c' };
  assert.strictEqual(L.camLabel(cam), 'Sony A7 III S-Log3');
  assert.strictEqual(L.camLabel({ brand: 'panasonic', model: 'GH5', profile: 'vlog' }), 'Panasonic GH5 V-Log');
  assert.match(L.searchURL(cam), /^https:\/\/www\.google\.com\/search\?q=Sony%20A7%20III%20S-Log3/);
});
