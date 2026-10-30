/* RR FX : conversion LOG → Rec.709 : courbes log des fabricants, gamuts, et LUT de conversion
   calculée (quand on n'a pas la LUT officielle). Formules publiées par les fabricants (Sony,
   Panasonic, Canon, Fujifilm, Nikon, DJI, Apple, Blackmagic, ARRI).

   Dans Premiere, une vidéo 10 bits « plage vidéo » arrive avec le code 64 à 0 et 940 à 1.
   Certaines formules donnent le code sur 1023 (« code »), d'autres la valeur IRE (« ire »). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXLog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const log10 = Math.log10, pow = Math.pow;

  // ---------------------------------------------------------------- courbes (encode : linéaire → signal)

  const SL3 = 171.2102946929;
  const flog = (a, b, c, d, e, f, cut1, cut2) => ({
    encode: x => (x >= cut1 ? c * log10(a * x + b) + d : e * x + f),
    decode: y => (y >= cut2 ? (pow(10, (y - d) / c) - b) / a : (y - f) / e)
  });
  // Courbes Canon : signée autour de 0, entrée en réflectance (lin = u × 0,9).
  const canon = (k, m, o) => ({
    encode: x => { const u = x / 0.9; return u >= 0 ? k * log10(m * u + 1) + o : -k * log10(-m * u + 1) + o; },
    decode: y => 0.9 * (y >= o ? (pow(10, (y - o) / k) - 1) / m : -(pow(10, (o - y) / k) - 1) / m)
  });
  const C4 = (() => {
    const a = (pow(2, 18) - 16) / 117.45, b = (1023 - 95) / 1023, c = 95 / 1023;
    const s = (7 * Math.LN2 * pow(2, 7 - 14 * c / b)) / (a * b), t = (pow(2, 14 * (-c / b) + 6) - 64) / a;
    return {
      encode: x => (x >= t ? (Math.log2(a * x + 64) - 6) / 14 * b + c : (x - t) / s),
      decode: y => (y >= 0 ? (pow(2, 14 * (y - c) / b + 6) - 64) / a : y * s + t)
    };
  })();
  const APPLE = (() => {
    const R0 = -0.05641088, Rt = 0.01, c = 47.28711236, b = 0.00964052, g = 0.08550479, be = 0.69336945, Pt = c * (Rt - R0) * (Rt - R0);
    return {
      encode: x => (x >= Rt ? g * Math.log2(x + b) + be : x >= R0 ? c * (x - R0) * (x - R0) : 0),
      decode: y => (y >= Pt ? pow(2, (y - be) / g) - b : y > 0 ? Math.sqrt(y / c) + R0 : R0)
    };
  })();

  const CURVES = {
    slog3: {
      label: 'S-Log3', range: 'code',
      encode: x => (x >= 0.01125 ? 420 + log10((x + 0.01) / 0.19) * 261.5 : x * (SL3 - 95) / 0.01125 + 95) / 1023,
      decode: y => { const c = y * 1023; return c >= SL3 ? pow(10, (c - 420) / 261.5) * 0.19 - 0.01 : (c - 95) * 0.01125 / (SL3 - 95); }
    },
    slog2: {
      label: 'S-Log2', range: 'ire',
      encode: x => { const u = x * 155 / 219 / 0.9; return u >= 0 ? 0.432699 * log10(u + 0.037584) + 0.646596 : u * 5 + 0.030001222851889303; },
      decode: y => (y >= 0.030001222851889303 ? pow(10, (y - 0.646596) / 0.432699) - 0.037584 : (y - 0.030001222851889303) / 5) * 0.9 * 219 / 155
    },
    vlog: {
      label: 'V-Log', range: 'code',
      encode: x => (x < 0.01 ? 5.6 * x + 0.125 : 0.241514 * log10(x + 0.00873) + 0.598206),
      decode: y => (y < 0.181 ? (y - 0.125) / 5.6 : pow(10, (y - 0.598206) / 0.241514) - 0.00873)
    },
    clog: Object.assign({ label: 'C-Log', range: 'ire' }, canon(0.529136, 10.1596, 0.0730597)),
    clog2: Object.assign({ label: 'C-Log2', range: 'ire' }, canon(0.24136077, 87.09937546, 0.092864125)),
    clog3: {
      label: 'C-Log3', range: 'ire',
      encode: x => { const u = x / 0.9; return u < -0.014 ? -0.36726845 * log10(-u * 14.98325 + 1) + 0.12783901 : u <= 0.014 ? 1.9754798 * u + 0.12512219 : 0.36726845 * log10(u * 14.98325 + 1) + 0.12240537; },
      decode: y => 0.9 * (y < 0.097465473 ? -(pow(10, (0.12783901 - y) / 0.36726845) - 1) / 14.98325 : y <= 0.15277891 ? (y - 0.12512219) / 1.9754798 : (pow(10, (y - 0.12240537) / 0.36726845) - 1) / 14.98325)
    },
    flog: Object.assign({ label: 'F-Log', range: 'code' }, flog(0.555556, 0.009468, 0.344676, 0.790453, 8.735631, 0.092864, 0.00089, 0.100537775223865)),
    flog2: Object.assign({ label: 'F-Log2', range: 'code' }, flog(5.555556, 0.064829, 0.245281, 0.384316, 8.799461, 0.092864, 0.000889, 0.100686685370811)),
    nlog: {
      label: 'N-Log', range: 'code',
      encode: x => (x < 0.328 ? 650 / 1023 * Math.cbrt(x + 0.0075) : 150 / 1023 * Math.log(x) + 619 / 1023),
      decode: y => (y < 452 / 1023 ? pow(y / (650 / 1023), 3) - 0.0075 : Math.exp((y - 619 / 1023) / (150 / 1023)))
    },
    dlog: {
      label: 'D-Log', range: 'code',
      encode: x => (x <= 0.0078 ? 6.025 * x + 0.0929 : log10(x * 0.9892 + 0.0108) * 0.256663 + 0.584555),
      decode: y => (y <= 0.14 ? (y - 0.0929) / 6.025 : (pow(10, 3.89616 * y - 2.27752) - 0.0108) / 0.9892)
    },
    applelog: Object.assign({ label: 'Apple Log', range: 'ire' }, APPLE),
    bmdfilm5: {
      label: 'Blackmagic Film Gen 5', range: 'code',
      encode: x => (x < 0.005 ? 8.283605932402494 * x + 0.09246575342465753 : 0.08692876065491224 * Math.log(x + 0.005494072432257808) + 0.5300133392291939),
      decode: y => (y < 8.283605932402494 * 0.005 + 0.09246575342465753 ? (y - 0.09246575342465753) / 8.283605932402494 : Math.exp((y - 0.5300133392291939) / 0.08692876065491224) - 0.005494072432257808)
    },
    logc3: Object.assign({ label: 'LogC3', range: 'code' }, flog(5.555556, 0.052272, 0.247190, 0.385537, 5.367655, 0.092809, 0.010591, 5.367655 * 0.010591 + 0.092809)),
    logc4: Object.assign({ label: 'LogC4', range: 'code' }, C4)
  };

  // Valeur Premiere (0 = code 64, 1 = code 940) ↔ valeur de la formule.
  const toFormula = (curve, v) => (curve.range === 'code' ? (64 + 876 * v) / 1023 : v);
  const fromFormula = (curve, y) => (curve.range === 'code' ? (y * 1023 - 64) / 876 : y);

  // ---------------------------------------------------------------- gamuts (primaires xy, blanc D65)

  const GAMUTS = {
    rec709: { label: 'Rec.709', p: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]] },
    rec2020: { label: 'Rec.2020', p: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]] },
    sgamut3cine: { label: 'S-Gamut3.Cine', p: [[0.766, 0.275], [0.225, 0.800], [0.089, -0.087]] },
    sgamut3: { label: 'S-Gamut3', p: [[0.730, 0.280], [0.140, 0.855], [0.100, -0.050]] },
    vgamut: { label: 'V-Gamut', p: [[0.730, 0.280], [0.165, 0.840], [0.100, -0.030]] },
    cinema: { label: 'Cinema Gamut', p: [[0.740, 0.270], [0.170, 1.140], [0.080, -0.100]] },
    dgamut: { label: 'D-Gamut', p: [[0.71, 0.31], [0.21, 0.88], [0.09, -0.08]] },
    bmdwg5: { label: 'Blackmagic Wide Gamut', p: [[0.7177, 0.3171], [0.2280, 0.8616], [0.1006, -0.0820]], w: [0.3127, 0.3290] },
    awg3: { label: 'ARRI Wide Gamut 3', p: [[0.6840, 0.3130], [0.2210, 0.8480], [0.0861, -0.1020]] },
    awg4: { label: 'ARRI Wide Gamut 4', p: [[0.7347, 0.2653], [0.1424, 0.8576], [0.0991, -0.0308]] }
  };
  const D65 = [0.3127, 0.3290];

  function inv3(m) {
    const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  }
  const mul3 = (m, n) => m.map(r => [0, 1, 2].map(j => r[0] * n[0][j] + r[1] * n[1][j] + r[2] * n[2][j]));
  const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];

  // Matrice RVB → XYZ d'après les primaires et le blanc.
  function toXYZ(g) {
    const P = g.p.map(xyz), W = xyz(g.w || D65), Pt = [[P[0][0], P[1][0], P[2][0]], [P[0][1], P[1][1], P[2][1]], [P[0][2], P[1][2], P[2][2]]];
    const S = inv3(Pt).map(r => r[0] * W[0] + r[1] * W[1] + r[2] * W[2]);
    return Pt.map(r => [r[0] * S[0], r[1] * S[1], r[2] * S[2]]);
  }
  const cache = {};
  function matrix(gamut) {
    if (!cache[gamut]) cache[gamut] = mul3(inv3(toXYZ(GAMUTS.rec709)), toXYZ(GAMUTS[gamut]));
    return cache[gamut];
  }

  // ---------------------------------------------------------------- profils et caméras

  /* Profil = courbe + gamut. « official » : pas de formule publiée, il faut la LUT du fabricant. */
  const PROFILES = [
    { id: 'slog3-sg3c', label: 'S-Log3 / S-Gamut3.Cine', curve: 'slog3', gamut: 'sgamut3cine' },
    { id: 'slog3-sg3', label: 'S-Log3 / S-Gamut3', curve: 'slog3', gamut: 'sgamut3' },
    { id: 'slog2-sg', label: 'S-Log2 / S-Gamut', curve: 'slog2', gamut: 'sgamut3' },
    { id: 'vlog', label: 'V-Log / V-Log L (V-Gamut)', curve: 'vlog', gamut: 'vgamut' },
    { id: 'clog3-cg', label: 'C-Log3 / Cinema Gamut', curve: 'clog3', gamut: 'cinema' },
    { id: 'clog3-709', label: 'C-Log3 / BT.709', curve: 'clog3', gamut: 'rec709' },
    { id: 'clog2-cg', label: 'C-Log2 / Cinema Gamut', curve: 'clog2', gamut: 'cinema' },
    { id: 'clog-709', label: 'C-Log / BT.709', curve: 'clog', gamut: 'rec709' },
    { id: 'flog2', label: 'F-Log2 / F-Gamut', curve: 'flog2', gamut: 'rec2020' },
    { id: 'flog', label: 'F-Log / F-Gamut', curve: 'flog', gamut: 'rec2020' },
    { id: 'nlog', label: 'N-Log / BT.2020', curve: 'nlog', gamut: 'rec2020' },
    { id: 'dlog', label: 'D-Log / D-Gamut', curve: 'dlog', gamut: 'dgamut' },
    { id: 'dlogm', label: 'D-Log M', official: true },
    { id: 'applelog', label: 'Apple Log / BT.2020', curve: 'applelog', gamut: 'rec2020' },
    { id: 'bmdfilm5', label: 'Blackmagic Film Gen 5', curve: 'bmdfilm5', gamut: 'bmdwg5' },
    { id: 'gplog', label: 'GP-Log', official: true },
    { id: 'samsunglog', label: 'Samsung Log', official: true },
    { id: 'logc3', label: 'LogC3 / ARRI Wide Gamut 3', curve: 'logc3', gamut: 'awg3' },
    { id: 'logc4', label: 'LogC4 / ARRI Wide Gamut 4', curve: 'logc4', gamut: 'awg4' },
    { id: 'other', label: _T('Autre (LUT du fabricant)'), official: true }
  ];
  const profile = id => PROFILES.find(p => p.id === id) || null;

  const BRANDS = [
    { id: 'sony', label: 'Sony', models: ['A7 III', 'A7 IV', 'A7S III', 'A7C II', 'A7R V', 'FX3', 'FX30', 'FX6', 'ZV-E1', 'ZV-E10 II', 'A6700', 'A6400'], profiles: ['slog3-sg3c', 'slog3-sg3', 'slog2-sg'] },
    { id: 'panasonic', label: 'Panasonic', models: ['GH5', 'GH6', 'GH7', 'S5', 'S5 II', 'S5 IIX', 'G9 II', 'S9', 'S1H'], profiles: ['vlog'] },
    { id: 'canon', label: 'Canon', models: ['EOS R5', 'EOS R5 II', 'EOS R6 II', 'EOS R7', 'EOS R8', 'EOS R50 V', 'EOS C70', 'EOS R5 C'], profiles: ['clog3-cg', 'clog3-709', 'clog2-cg', 'clog-709'] },
    { id: 'fujifilm', label: 'Fujifilm', models: ['X-T5', 'X-H2S', 'X-H2', 'X-S20', 'X-T50', 'X-M5', 'X-T4', 'GFX100 II'], profiles: ['flog2', 'flog'] },
    { id: 'nikon', label: 'Nikon', models: ['Z6 III', 'Z6 II', 'Z8', 'Z9', 'Zf', 'Z5 II', 'Z50 II'], profiles: ['nlog'] },
    { id: 'dji', label: 'DJI', models: ['Mavic 3', 'Mavic 4 Pro', 'Air 3', 'Mini 4 Pro', 'Osmo Pocket 3', 'Osmo Action 5 Pro', 'Avata 2', 'Ronin 4D'], profiles: ['dlogm', 'dlog'] },
    { id: 'apple', label: 'Apple', models: ['iPhone 15 Pro', 'iPhone 16 Pro', 'iPhone 17 Pro'], profiles: ['applelog'] },
    { id: 'blackmagic', label: 'Blackmagic', models: ['Pocket 4K', 'Pocket 6K', 'Cinema Camera 6K', 'PYXIS 6K', 'Blackmagic Camera (iPhone)'], profiles: ['bmdfilm5'] },
    { id: 'gopro', label: 'GoPro', models: ['HERO13 Black', 'HERO12 Black'], profiles: ['gplog'] },
    { id: 'samsung', label: 'Samsung', models: ['Galaxy S25 Ultra', 'Galaxy S24 Ultra'], profiles: ['samsunglog'] },
    { id: 'arri', label: 'ARRI', models: ['ALEXA Mini', 'ALEXA 35', 'AMIRA'], profiles: ['logc3', 'logc4'] },
    { id: 'other', label: _T('Autre'), models: [], profiles: PROFILES.map(p => p.id) }
  ];
  const brand = id => BRANDS.find(b => b.id === id) || BRANDS[BRANDS.length - 1];

  // ---------------------------------------------------------------- rendu Rec.709

  const CONTRASTS = {
    soft: { label: _T('Doux'), gamma: 0.9, knee: 0.7 },
    standard: { label: 'Standard', gamma: 1, knee: 0.8 },
    strong: { label: _T('Contrasté'), gamma: 1.12, knee: 0.86 }
  };

  // Linéaire scène (gris 18 % = 0,18) → signal Rec.709 : contraste autour du gris, OETF BT.709,
  // puis épaule douce au-dessus du genou (les hautes lumières du log ne sont pas brûlées net).
  function display(x, contrast) {
    const c = CONTRASTS[contrast] || CONTRASTS.standard;
    if (!(x > 0)) return 0;
    if (c.gamma !== 1) x = 0.18 * pow(x / 0.18, c.gamma);
    let y = x < 0.018 ? 4.5 * x : 1.099 * pow(x, 0.45) - 0.099;
    if (y > c.knee) { const e = y - c.knee, r = 1 - c.knee; y = c.knee + e / (1 + e / r); }
    return Math.min(1, y);
  }

  // Valeur Premiere → linéaire scène (même gamut que la caméra).
  function toLinear(profileId, v) {
    const p = profile(profileId), c = p && CURVES[p.curve];
    if (!c) throw new Error(_T('Pas de formule pour ') + (p ? p.label : profileId));
    return c.decode(toFormula(c, v));
  }
  function fromLinear(profileId, x) {
    const p = profile(profileId), c = CURVES[p.curve];
    return fromFormula(c, c.encode(x));
  }

  /* Fonction (r, v, b Premiere) → Rec.709. o.ev : exposition au tournage (+1,7 = surexposé de 1,7 IL). */
  function converter(profileId, o) {
    o = o || {};
    const p = profile(profileId);
    if (!p || p.official) throw new Error(_T('Pas de formule publiée pour ') + (p ? p.label : profileId) + _T(' : il faut la LUT du fabricant.'));
    const c = CURVES[p.curve], M = matrix(p.gamut), k = pow(2, -(Number(o.ev) || 0)), con = o.contrast;
    return (r, g, b) => {
      const lr = c.decode(toFormula(c, r)) * k, lg = c.decode(toFormula(c, g)) * k, lb = c.decode(toFormula(c, b)) * k;
      let R = M[0][0] * lr + M[0][1] * lg + M[0][2] * lb;
      let G = M[1][0] * lr + M[1][1] * lg + M[1][2] * lb;
      let B = M[2][0] * lr + M[2][1] * lg + M[2][2] * lb;
      // Hors gamut Rec.709 : on désature juste assez pour revenir dans le triangle (la teinte reste).
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B, mn = Math.min(R, G, B);
      if (mn < 0 && lum > 0) { const t = lum / (lum - mn); R = lum + (R - lum) * t; G = lum + (G - lum) * t; B = lum + (B - lum) * t; }
      return [display(R, con), display(G, con), display(B, con)];
    };
  }

  function buildLut(profileId, o) {
    o = o || {};
    const N = o.size || 33, f = converter(profileId, o), data = new Float32Array(N * N * N * 3);
    let i = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const v = f(r / (N - 1), g / (N - 1), b / (N - 1));
      data[i++] = v[0]; data[i++] = v[1]; data[i++] = v[2];
    }
    return { title: '', size: N, dim: 3, min: [0, 0, 0], max: [1, 1, 1], data };
  }

  // ---------------------------------------------------------------- caméras enregistrées

  function camLabel(cam) {
    const b = brand(cam.brand), p = profile(cam.profile);
    return [b.id === 'other' ? '' : b.label, cam.model || '', p ? p.label.split(' / ')[0] : ''].filter(Boolean).join(' ');
  }
  // Recherche de la LUT officielle (le site du fabricant change souvent d'adresse).
  function searchURL(cam) {
    const b = brand(cam.brand), p = profile(cam.profile);
    const q = [b.id === 'other' ? '' : b.label, cam.model || '', p && !/^other$/.test(p.id) ? p.label : 'log', _T('to Rec.709 LUT officielle')].filter(Boolean).join(' ');
    return 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }
  const canCompute = id => { const p = profile(id); return !!(p && !p.official); };

  return { CURVES, GAMUTS, PROFILES, BRANDS, CONTRASTS, profile, brand, matrix, display, toLinear, fromLinear, converter, buildLut, camLabel, searchURL, canCompute };
});
