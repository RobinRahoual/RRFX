/* RR FX : moteur couleur façon Lightroom (module « Développement ») : mêmes panneaux et
   mêmes réglages (Réglages de base, Courbe des tonalités, Mélangeur de couleurs,
   Étalonnage des couleurs, Calibrage). Un seul calcul, trois sorties identiques :
   l'aperçu du panneau, une LUT .cube pour Premiere (Lumetri) et un DCTL pour DaVinci
   Resolve, avec les mêmes curseurs. Sans DOM : testé sous Node (le DCTL y est compilé en C
   et comparé au calcul JavaScript).

   Les images vidéo sont en Rec.709 : balance des blancs, exposition et calibrage sont
   faits en lumière linéaire, le reste sur les valeurs affichées, comme une retouche photo.
   Texture, Clarté, Correction du voile, vignettage et grain dépendent des pixels voisins :
   une LUT ne peut pas les porter (ils restent à faire dans Lumetri). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXDevelop = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const BANDS = [
    { id: 'red', label: _T('Rouge'), hue: 0 }, { id: 'orange', label: 'Orange', hue: 30 }, { id: 'yellow', label: _T('Jaune'), hue: 60 },
    { id: 'green', label: _T('Vert'), hue: 120 }, { id: 'aqua', label: _T('Bleu-vert'), hue: 180 }, { id: 'blue', label: _T('Bleu'), hue: 240 },
    { id: 'purple', label: _T('Violet'), hue: 270 }, { id: 'magenta', label: 'Magenta', hue: 300 }
  ];
  const WHEELS = ['shadows', 'midtones', 'highlights', 'global'];

  // Réglages par défaut : tout à zéro = image inchangée.
  function defaults() {
    const p = {
      temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0,
      pHighlights: 0, pLights: 0, pDarks: 0, pShadows: 0, split1: 25, split2: 50, split3: 75,
      curve: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
      hsl: {}, grading: {}, blending: 50, balance: 0,
      shadowTint: 0, redHue: 0, redSat: 0, greenHue: 0, greenSat: 0, blueHue: 0, blueSat: 0,
      amount: 100
    };
    BANDS.forEach(b => { p.hsl[b.id] = { h: 0, s: 0, l: 0 }; });
    WHEELS.forEach(w => { p.grading[w] = { h: 0, s: 0, l: 0 }; });
    return p;
  }

  // Complète des réglages partiels (preset, look partagé, ancienne version).
  function normalize(src) {
    const p = defaults();
    if (!src || typeof src !== 'object') return p;
    Object.keys(p).forEach(k => {
      if (typeof p[k] === 'number' && typeof src[k] === 'number' && isFinite(src[k])) p[k] = src[k];
    });
    if (src.curve) ['rgb', 'r', 'g', 'b'].forEach(c => {
      const pts = src.curve[c];
      if (Array.isArray(pts) && pts.length >= 2 && pts.every(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]))) {
        p.curve[c] = pts.map(q => [clamp(q[0], 0, 1), clamp(q[1], 0, 1)]).sort((a, b) => a[0] - b[0]);
      }
    });
    ['hsl', 'grading'].forEach(g => {
      Object.keys(p[g]).forEach(k => {
        const s = src[g] && src[g][k];
        if (s) ['h', 's', 'l'].forEach(x => { if (typeof s[x] === 'number' && isFinite(s[x])) p[g][k][x] = s[x]; });
      });
    });
    return p;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lin = v => (v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45));
  const gam = v => (v < 0.018 ? v * 4.5 : 1.099 * Math.pow(v, 0.45) - 0.099);
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // ---------------------------------------------------------------- courbes à points

  // Courbe monotone (Fritsch-Carlson) échantillonnée sur 256 valeurs : la même table sert à
  // l'aperçu, à la LUT et au DCTL.
  function curveTable(points, n) {
    n = n || 256;
    const pts = points.slice().sort((a, b) => a[0] - b[0]), m = pts.length, out = new Float32Array(n);
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), d = [], t = new Array(m).fill(0);
    for (let i = 0; i < m - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    for (let i = 1; i < m - 1; i++) t[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    if (m > 1) { t[0] = d[0]; t[m - 1] = d[m - 2]; }
    for (let i = 0; i < m - 1; i++) {
      if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / d[i], b = t[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i]; }
    }
    for (let j = 0; j < n; j++) {
      const x = j / (n - 1);
      if (x <= xs[0]) { out[j] = ys[0]; continue; }
      if (x >= xs[m - 1]) { out[j] = ys[m - 1]; continue; }
      let i = 0;
      while (i < m - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h, u2 = u * u, u3 = u2 * u;
      out[j] = clamp((2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * t[i + 1], 0, 1);
    }
    return out;
  }
  const isIdentity = pts => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
  function lookup(t, x) {
    const f = clamp(x, 0, 1) * 255, i = Math.min(254, Math.floor(f)), u = f - i;
    return t[i] * (1 - u) + t[i + 1] * u;
  }

  // ---------------------------------------------------------------- calcul

  function bump(x, a, b) {
    const c = (a + b) / 2, hw = Math.max(1e-3, b - a), d = (x - c) / hw;
    if (d <= -1 || d >= 1) return 0;
    const k = Math.cos(d * Math.PI / 2);
    return k * k;
  }

  // Une zone de la courbe paramétrique : amplitude limitée pour que la pente reste positive.
  function region(x, amount, a, b) {
    if (!amount) return x;
    const amp = Math.min(0.12, 0.57 * Math.max(1e-3, b - a));
    return clamp(x + amp * (amount / 100) * bump(x, a, b), 0, 1);
  }

  // Courbe de tonalité (Réglages de base + Courbe paramétrique), sans la courbe à points.
  function tone(x, p) {
    x = clamp(x, 0, 1);
    x = x + 0.15 * (p.blacks / 100) * Math.pow(1 - x, 3) + 0.15 * (p.whites / 100) * x * x * x;
    x = clamp(x, 0, 1);
    x = x + 0.12 * 6.75 * ((p.shadows / 100) * x * (1 - x) * (1 - x) + (p.highlights / 100) * x * x * (1 - x));
    x = clamp(x, 0, 1);
    const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    x = x + 0.6 * (p.contrast / 100) * (s - x);
    // Courbe paramétrique : une zone après l'autre, chacune monotone (la courbe ne se replie
    // jamais, même avec des curseurs extrêmes ou des séparations rapprochées).
    const s1 = p.split1 / 100, s2 = p.split2 / 100, s3 = p.split3 / 100;
    x = region(x, p.pShadows, 0, s1);
    x = region(x, p.pDarks, s1, s2);
    x = region(x, p.pLights, s2, s3);
    x = region(x, p.pHighlights, s3, 1);
    return clamp(x, 0, 1);
  }

  // Colonne d'une primaire (Calibrage) : teinte vers la primaire voisine, saturation autour du gris.
  function primary(idx, hue, sat) {
    const c = [0, 0, 0];
    c[idx] = 1;
    if (hue > 0) c[(idx + 1) % 3] += 0.4 * hue; else c[(idx + 2) % 3] += -0.4 * hue;
    const y = luma(c[0], c[1], c[2]), k = 1 + 0.6 * sat;
    return [y + (c[0] - y) * k, y + (c[1] - y) * k, y + (c[2] - y) * k];
  }

  function hsv2rgb(h, s, v) {
    h = h - 360 * Math.floor(h / 360);
    const c = v * s, hp = h / 60, x = c * (1 - Math.abs((hp - 2 * Math.floor(hp / 2)) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }
  function hueOf(r, g, b, mx, c) {
    let h;
    if (mx === r) h = 60 * ((g - b) / c);
    else if (mx === g) h = 60 * ((b - r) / c + 2);
    else h = 60 * ((r - g) / c + 4);
    return h - 360 * Math.floor(h / 360);
  }
  // Direction de couleur d'une roue (teinte H) : la couleur pure moins sa luminance.
  function tintDir(h) {
    const c = hsv2rgb(h, 1, 1), y = luma(c[0], c[1], c[2]);
    return [c[0] - y, c[1] - y, c[2] - y];
  }

  /* Prépare le calcul pour des réglages : renvoie f(r, g, b) -> [r, g, b] (valeurs 0..1). */
  function compile(params) {
    const p = normalize(params);
    // Calibrage : matrice des primaires, blanc conservé.
    const cr = primary(0, p.redHue / 100, p.redSat / 100), cg = primary(1, p.greenHue / 100, p.greenSat / 100), cb = primary(2, p.blueHue / 100, p.blueSat / 100);
    const rows = [0, 1, 2].map(k => [cr[k], cg[k], cb[k]].map(v => v / (cr[k] + cg[k] + cb[k])));
    const calib = p.redHue || p.redSat || p.greenHue || p.greenSat || p.blueHue || p.blueSat;
    // Balance des blancs et exposition.
    const t = p.temp / 100, u = p.tint / 100;
    let kr = 1 + 0.3 * t, kg = 1 - 0.25 * u, kb = 1 - 0.3 * t;
    const n = luma(kr, kg, kb), ev = Math.pow(2, p.exposure);
    kr *= ev / n; kg *= ev / n; kb *= ev / n;
    const curves = {};
    ['rgb', 'r', 'g', 'b'].forEach(c => { curves[c] = isIdentity(p.curve[c]) ? null : curveTable(p.curve[c]); });
    const hueP = BANDS.map(b => p.hsl[b.id].h / 100), satP = BANDS.map(b => p.hsl[b.id].s / 100), lumP = BANDS.map(b => p.hsl[b.id].l / 100);
    const hslOn = hueP.concat(satP, lumP).some(v => v !== 0);
    const wheels = WHEELS.map(w => ({ dir: tintDir(p.grading[w].h), s: p.grading[w].s / 100, l: p.grading[w].l / 100 }));
    const m = clamp(0.5 - 0.25 * (p.balance / 100), 0.1, 0.9), pw = 2.5 - 2 * (p.blending / 100);
    const amount = clamp(p.amount, 0, 100) / 100;

    return function (r0, g0, b0) {
      let r = lin(clamp(r0, 0, 1)), g = lin(clamp(g0, 0, 1)), b = lin(clamp(b0, 0, 1));
      if (calib) {
        const R = rows[0][0] * r + rows[0][1] * g + rows[0][2] * b, G = rows[1][0] * r + rows[1][1] * g + rows[1][2] * b, B = rows[2][0] * r + rows[2][1] * g + rows[2][2] * b;
        r = R; g = G; b = B;
      }
      r = gam(Math.max(0, r * kr)); g = gam(Math.max(0, g * kg)); b = gam(Math.max(0, b * kb));
      // Tonalités, puis courbes à points (RVB, puis chaque couche).
      r = tone(r, p); g = tone(g, p); b = tone(b, p);
      if (curves.rgb) { r = lookup(curves.rgb, r); g = lookup(curves.rgb, g); b = lookup(curves.rgb, b); }
      if (curves.r) r = lookup(curves.r, r);
      if (curves.g) g = lookup(curves.g, g);
      if (curves.b) b = lookup(curves.b, b);
      // Mélangeur de couleurs (TSL par plage de teintes).
      if (hslOn) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
        if (c > 1e-5 && mx > 1e-5) {
          const h = hueOf(r, g, b, mx, c);
          let i = 7;
          for (let k = 0; k < 7; k++) if (h >= BANDS[k].hue && h < BANDS[k + 1].hue) { i = k; break; }
          const h0 = BANDS[i].hue, h1 = i === 7 ? 360 : BANDS[i + 1].hue, j = (i + 1) % 8, w = (h - h0) / (h1 - h0);
          const dh = hueP[i] * (1 - w) + hueP[j] * w, ds = satP[i] * (1 - w) + satP[j] * w, dl = lumP[i] * (1 - w) + lumP[j] * w;
          const s = c / mx, out = hsv2rgb(h + 30 * dh, clamp(s * (1 + ds), 0, 1), mx), f = 1 + 0.35 * dl * s;
          r = out[0] * f; g = out[1] * f; b = out[2] * f;
        }
      }
      // Étalonnage des couleurs : ombres, tons moyens, hautes lumières, global.
      let L = luma(r, g, b);
      const ws = Math.pow(clamp((m - L) / m, 0, 1), pw), wh = Math.pow(clamp((L - m) / (1 - m), 0, 1), pw), wm = Math.max(0, 1 - ws - wh);
      const wt = [ws, wm, wh, 1], gain = [0.4, 0.4, 0.4, 0.25], lgain = [0.25, 0.25, 0.25, 0.2];
      for (let k = 0; k < 4; k++) {
        const W = wheels[k];
        if (!W.s && !W.l) continue;
        r += wt[k] * (W.s * gain[k] * W.dir[0] + W.l * lgain[k]);
        g += wt[k] * (W.s * gain[k] * W.dir[1] + W.l * lgain[k]);
        b += wt[k] * (W.s * gain[k] * W.dir[2] + W.l * lgain[k]);
      }
      // Calibrage : teinte des ombres (vert ↔ magenta).
      if (p.shadowTint) {
        const sh = (1 - clamp(L, 0, 1)) * (1 - clamp(L, 0, 1)) * (p.shadowTint / 100);
        r += 0.04 * sh; g -= 0.08 * sh; b += 0.04 * sh;
      }
      // Présence : vibrance (protège les tons chair) et saturation.
      if (p.vibrance || p.saturation) {
        L = luma(r, g, b);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 1e-5 ? clamp((mx - mn) / mx, 0, 1) : 0;
        let protect = 1;
        if (p.vibrance && mx - mn > 1e-5) { const h = hueOf(r, g, b, mx, mx - mn); if (h < 50 || h > 345) protect = 0.5; }
        const k = (1 + p.saturation / 100) * (1 + (p.vibrance / 100) * 0.8 * (1 - sat) * protect);
        r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k;
      }
      r = clamp(r, 0, 1); g = clamp(g, 0, 1); b = clamp(b, 0, 1);
      if (amount < 1) { r = r0 + (r - r0) * amount; g = g0 + (g - g0) * amount; b = b0 + (b - b0) * amount; }
      return [r, g, b];
    };
  }

  // ---------------------------------------------------------------- sorties

  /* LUT 3D (même format que RRFXAssets.parseCube, utilisable par applyLut). */
  function buildLut(params, size) {
    const N = size || 33, f = compile(params), data = new Float32Array(N * N * N * 3);
    let o = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const v = f(r / (N - 1), g / (N - 1), b / (N - 1));
      data[o++] = v[0]; data[o++] = v[1]; data[o++] = v[2];
    }
    return { title: '', size: N, dim: 3, min: [0, 0, 0], max: [1, 1, 1], data };
  }

  function toCube(lut, title) {
    const lines = ['# Créé avec RR FX (@robin.rahoual), onglet Couleur', 'TITLE "' + String(title || 'RR FX').replace(/"/g, '\'') + '"', 'LUT_3D_SIZE ' + lut.size, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
    const d = lut.data;
    for (let i = 0; i < d.length; i += 3) lines.push(d[i].toFixed(6) + ' ' + d[i + 1].toFixed(6) + ' ' + d[i + 2].toFixed(6));
    return lines.join('\n') + '\n';
  }

  // Curseurs du DCTL : [nom du paramètre, libellé (ASCII), clé dans les réglages, min, max, pas].
  function sliderList() {
    const S = [
      ['temp', 'Temperature', 'temp', -100, 100, 1], ['tint', _T('Teinte'), 'tint', -100, 100, 1], ['exposure', _T('Exposition'), 'exposure', -5, 5, 0.01],
      ['contrast', _T('Contraste'), 'contrast', -100, 100, 1], ['highlights', _T('Hautes lumieres'), 'highlights', -100, 100, 1], ['shadows', _T('Ombres'), 'shadows', -100, 100, 1],
      ['whites', _T('Blancs'), 'whites', -100, 100, 1], ['blacks', _T('Noirs'), 'blacks', -100, 100, 1], ['vibrance', 'Vibrance', 'vibrance', -100, 100, 1], ['saturation', 'Saturation', 'saturation', -100, 100, 1],
      ['pHighlights', _T('Courbe Hautes lumieres'), 'pHighlights', -100, 100, 1], ['pLights', _T('Courbe Tons clairs'), 'pLights', -100, 100, 1], ['pDarks', _T('Courbe Tons fonces'), 'pDarks', -100, 100, 1], ['pShadows', _T('Courbe Ombres'), 'pShadows', -100, 100, 1]
    ];
    const ascii = { Rouge: _T('Rouge'), Orange: 'Orange', Jaune: _T('Jaune'), Vert: _T('Vert'), 'Bleu-vert': _T('Bleu-vert'), Bleu: _T('Bleu'), Violet: _T('Violet'), Magenta: 'Magenta' };
    [['h', _T('Teinte')], ['s', 'Saturation'], ['l', 'Luminance']].forEach(([k, lab]) => BANDS.forEach(b => S.push(['hsl_' + b.id + '_' + k, lab + ' ' + ascii[b.label], 'hsl.' + b.id + '.' + k, -100, 100, 1])));
    const wl = { shadows: _T('Ombres'), midtones: _T('Tons moyens'), highlights: _T('Hautes lumieres'), global: 'Global' };
    WHEELS.forEach(w => {
      S.push(['grade_' + w + '_h', wl[w] + _T(' Teinte'), 'grading.' + w + '.h', 0, 360, 1]);
      S.push(['grade_' + w + '_s', wl[w] + ' Saturation', 'grading.' + w + '.s', 0, 100, 1]);
      S.push(['grade_' + w + '_l', wl[w] + ' Luminance', 'grading.' + w + '.l', -100, 100, 1]);
    });
    S.push(['blending', _T('Fusion'), 'blending', 0, 100, 1], ['balance', _T('Equilibre'), 'balance', -100, 100, 1]);
    S.push(['shadowTint', _T('Calibrage Ombres'), 'shadowTint', -100, 100, 1], ['redHue', _T('Rouge primaire Teinte'), 'redHue', -100, 100, 1], ['redSat', _T('Rouge primaire Saturation'), 'redSat', -100, 100, 1],
      ['greenHue', _T('Vert primaire Teinte'), 'greenHue', -100, 100, 1], ['greenSat', _T('Vert primaire Saturation'), 'greenSat', -100, 100, 1],
      ['blueHue', _T('Bleu primaire Teinte'), 'blueHue', -100, 100, 1], ['blueSat', _T('Bleu primaire Saturation'), 'blueSat', -100, 100, 1], ['amount', _T('Intensite du look'), 'amount', 0, 100, 1]);
    return S;
  }
  const getKey = (p, key) => key.split('.').reduce((o, k) => o[k], p);
  const f = v => { const s = Number(v).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0'); return s.indexOf('.') < 0 ? s + '.0' : s; };

  /* DCTL pour DaVinci Resolve : les curseurs de Lightroom (valeurs actuelles par défaut) et
     les courbes à points intégrées. Même calcul que compile(). */
  function toDCTL(params, title) {
    const p = normalize(params), S = sliderList();
    const L = [];
    // Tout en ASCII : le DCTL est compilé pour la carte graphique par Resolve.
    const ascii = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');
    L.push('// ' + ascii(title || 'RR FX') + _T(' : look cree avec RR FX (@robin.rahoual) - onglet Couleur.'));
    L.push('// Curseurs facon Lightroom. Entree et sortie : Rec.709 (gamma 2.4).');
    L.push('// Texture, Clarte, Correction du voile, vignettage et grain ne sont pas inclus.');
    L.push('');
    S.forEach(s => L.push('DEFINE_UI_PARAMS(' + s[0] + ', ' + s[1] + ', DCTLUI_SLIDER_FLOAT, ' + f(getKey(p, s[2])) + ', ' + f(s[3]) + ', ' + f(s[4]) + ', ' + f(s[5]) + ')'));
    L.push('');
    const curveNames = ['rgb', 'r', 'g', 'b'].filter(c => !isIdentity(p.curve[c]));
    curveNames.forEach(c => {
      const t = curveTable(p.curve[c]);
      L.push('__CONSTANT__ float CURVE_' + c.toUpperCase() + '[256] = {' + Array.from(t).map(v => f(Math.round(v * 1e6) / 1e6) + 'f').join(', ') + '};');
    });
    if (curveNames.length) L.push('');
    L.push(DCTL_BODY.replace('%SPLITS%', 'const float s1 = ' + f(p.split1 / 100) + 'f, s2 = ' + f(p.split2 / 100) + 'f, s3 = ' + f(p.split3 / 100) + 'f;')
      .replace('%CURVES%', curveNames.map(c => c === 'rgb'
        ? '    r = lookup(CURVE_RGB, r); g = lookup(CURVE_RGB, g); b = lookup(CURVE_RGB, b);'
        : '    ' + c + ' = lookup(CURVE_' + c.toUpperCase() + ', ' + c + ');').join('\n')));
    return L.join('\n') + '\n';
  }

  const DCTL_BODY = [
    '__DEVICE__ float clampf(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }',
    '__DEVICE__ float lin709(float v) { return v < 0.081f ? v / 4.5f : _powf((v + 0.099f) / 1.099f, 1.0f / 0.45f); }',
    '__DEVICE__ float gam709(float v) { return v < 0.018f ? v * 4.5f : 1.099f * _powf(v, 0.45f) - 0.099f; }',
    '__DEVICE__ float luma(float r, float g, float b) { return 0.2126f * r + 0.7152f * g + 0.0722f * b; }',
    '__DEVICE__ float lookup(__CONSTANTREF__ float* t, float x) {',
    '    float f = clampf(x, 0.0f, 1.0f) * 255.0f;',
    '    int i = (int)_floorf(f);',
    '    if (i > 254) i = 254;',
    '    float u = f - (float)i;',
    '    return t[i] * (1.0f - u) + t[i + 1] * u;',
    '}',
    '__DEVICE__ float bump(float x, float a, float b) {',
    '    float c = (a + b) * 0.5f, hw = _fmaxf(0.001f, b - a), d = (x - c) / hw;',
    '    if (d <= -1.0f || d >= 1.0f) return 0.0f;',
    '    float k = _cosf(d * 1.5707963f);',
    '    return k * k;',
    '}',
    '__DEVICE__ float region(float x, float amount, float a, float b) {',
    '    if (amount == 0.0f) return x;',
    '    float amp = _fminf(0.12f, 0.57f * _fmaxf(0.001f, b - a));',
    '    return clampf(x + amp * (amount / 100.0f) * bump(x, a, b), 0.0f, 1.0f);',
    '}',
    '__DEVICE__ float tone(float x, float blacks, float whites, float shadows, float highlights, float contrast, float ps, float pd, float pl, float ph) {',
    '    %SPLITS%',
    '    x = clampf(x, 0.0f, 1.0f);',
    '    x = x + 0.15f * (blacks / 100.0f) * (1.0f - x) * (1.0f - x) * (1.0f - x) + 0.15f * (whites / 100.0f) * x * x * x;',
    '    x = clampf(x, 0.0f, 1.0f);',
    '    x = x + 0.12f * 6.75f * ((shadows / 100.0f) * x * (1.0f - x) * (1.0f - x) + (highlights / 100.0f) * x * x * (1.0f - x));',
    '    x = clampf(x, 0.0f, 1.0f);',
    '    float s = x < 0.5f ? 2.0f * x * x : 1.0f - 2.0f * (1.0f - x) * (1.0f - x);',
    '    x = x + 0.6f * (contrast / 100.0f) * (s - x);',
    '    x = region(x, ps, 0.0f, s1);',
    '    x = region(x, pd, s1, s2);',
    '    x = region(x, pl, s2, s3);',
    '    x = region(x, ph, s3, 1.0f);',
    '    return clampf(x, 0.0f, 1.0f);',
    '}',
    '__DEVICE__ float3 hsv2rgb(float h, float s, float v) {',
    '    h = h - 360.0f * _floorf(h / 360.0f);',
    '    float c = v * s, hp = h / 60.0f, x = c * (1.0f - _fabs((hp - 2.0f * _floorf(hp / 2.0f)) - 1.0f)), m = v - c;',
    '    float r = 0.0f, g = 0.0f, b = 0.0f;',
    '    if (hp < 1.0f) { r = c; g = x; } else if (hp < 2.0f) { r = x; g = c; } else if (hp < 3.0f) { g = c; b = x; }',
    '    else if (hp < 4.0f) { g = x; b = c; } else if (hp < 5.0f) { r = x; b = c; } else { r = c; b = x; }',
    '    return make_float3(r + m, g + m, b + m);',
    '}',
    '__DEVICE__ float hueOf(float r, float g, float b, float mx, float c) {',
    '    float h;',
    '    if (mx == r) h = 60.0f * ((g - b) / c);',
    '    else if (mx == g) h = 60.0f * ((b - r) / c + 2.0f);',
    '    else h = 60.0f * ((r - g) / c + 4.0f);',
    '    return h - 360.0f * _floorf(h / 360.0f);',
    '}',
    '__DEVICE__ float3 primaryCol(int idx, float hue, float sat) {',
    '    float c[3] = {0.0f, 0.0f, 0.0f};',
    '    c[idx] = 1.0f;',
    '    if (hue > 0.0f) c[(idx + 1) % 3] += 0.4f * hue; else c[(idx + 2) % 3] += -0.4f * hue;',
    '    float y = luma(c[0], c[1], c[2]), k = 1.0f + 0.6f * sat;',
    '    return make_float3(y + (c[0] - y) * k, y + (c[1] - y) * k, y + (c[2] - y) * k);',
    '}',
    '__DEVICE__ float3 tintDir(float h) {',
    '    float3 c = hsv2rgb(h, 1.0f, 1.0f);',
    '    float y = luma(c.x, c.y, c.z);',
    '    return make_float3(c.x - y, c.y - y, c.z - y);',
    '}',
    '',
    '__DEVICE__ float3 transform(int p_Width, int p_Height, int p_X, int p_Y, float p_R, float p_G, float p_B)',
    '{',
    '    float r0 = clampf(p_R, 0.0f, 1.0f), g0 = clampf(p_G, 0.0f, 1.0f), b0 = clampf(p_B, 0.0f, 1.0f);',
    '    float r = lin709(r0), g = lin709(g0), b = lin709(b0);',
    '    // Calibrage (primaires), en lumiere lineaire.',
    '    if (redHue != 0.0f || redSat != 0.0f || greenHue != 0.0f || greenSat != 0.0f || blueHue != 0.0f || blueSat != 0.0f) {',
    '        float3 cr = primaryCol(0, redHue / 100.0f, redSat / 100.0f), cg = primaryCol(1, greenHue / 100.0f, greenSat / 100.0f), cb = primaryCol(2, blueHue / 100.0f, blueSat / 100.0f);',
    '        float nr = cr.x + cg.x + cb.x, ng = cr.y + cg.y + cb.y, nb = cr.z + cg.z + cb.z;',
    '        float R = (cr.x * r + cg.x * g + cb.x * b) / nr, G = (cr.y * r + cg.y * g + cb.y * b) / ng, B = (cr.z * r + cg.z * g + cb.z * b) / nb;',
    '        r = R; g = G; b = B;',
    '    }',
    '    // Balance des blancs et exposition.',
    '    float t = temp / 100.0f, u = tint / 100.0f;',
    '    float kr = 1.0f + 0.3f * t, kg = 1.0f - 0.25f * u, kb = 1.0f - 0.3f * t;',
    '    float n = luma(kr, kg, kb), ev = _powf(2.0f, exposure);',
    '    r = gam709(_fmaxf(0.0f, r * kr * ev / n)); g = gam709(_fmaxf(0.0f, g * kg * ev / n)); b = gam709(_fmaxf(0.0f, b * kb * ev / n));',
    '    // Tonalites et courbes.',
    '    r = tone(r, blacks, whites, shadows, highlights, contrast, pShadows, pDarks, pLights, pHighlights);',
    '    g = tone(g, blacks, whites, shadows, highlights, contrast, pShadows, pDarks, pLights, pHighlights);',
    '    b = tone(b, blacks, whites, shadows, highlights, contrast, pShadows, pDarks, pLights, pHighlights);',
    '%CURVES%',
    '    // Melangeur de couleurs.',
    '    float hueP[8] = {hsl_red_h, hsl_orange_h, hsl_yellow_h, hsl_green_h, hsl_aqua_h, hsl_blue_h, hsl_purple_h, hsl_magenta_h};',
    '    float satP[8] = {hsl_red_s, hsl_orange_s, hsl_yellow_s, hsl_green_s, hsl_aqua_s, hsl_blue_s, hsl_purple_s, hsl_magenta_s};',
    '    float lumP[8] = {hsl_red_l, hsl_orange_l, hsl_yellow_l, hsl_green_l, hsl_aqua_l, hsl_blue_l, hsl_purple_l, hsl_magenta_l};',
    '    float centers[9] = {0.0f, 30.0f, 60.0f, 120.0f, 180.0f, 240.0f, 270.0f, 300.0f, 360.0f};',
    '    {',
    '        float mx = _fmaxf(r, _fmaxf(g, b)), mn = _fminf(r, _fminf(g, b)), c = mx - mn;',
    '        if (c > 0.00001f && mx > 0.00001f) {',
    '            float h = hueOf(r, g, b, mx, c);',
    '            int i = 7;',
    '            for (int k = 0; k < 7; k++) { if (h >= centers[k] && h < centers[k + 1]) { i = k; break; } }',
    '            int j = (i + 1) % 8;',
    '            float w = (h - centers[i]) / (centers[i + 1] - centers[i]);',
    '            float dh = (hueP[i] * (1.0f - w) + hueP[j] * w) / 100.0f, ds = (satP[i] * (1.0f - w) + satP[j] * w) / 100.0f, dl = (lumP[i] * (1.0f - w) + lumP[j] * w) / 100.0f;',
    '            if (dh != 0.0f || ds != 0.0f || dl != 0.0f) {',
    '                float s = c / mx;',
    '                float3 o = hsv2rgb(h + 30.0f * dh, clampf(s * (1.0f + ds), 0.0f, 1.0f), mx);',
    '                float f = 1.0f + 0.35f * dl * s;',
    '                r = o.x * f; g = o.y * f; b = o.z * f;',
    '            }',
    '        }',
    '    }',
    '    // Etalonnage des couleurs.',
    '    float L = luma(r, g, b);',
    '    float m = clampf(0.5f - 0.25f * (balance / 100.0f), 0.1f, 0.9f), pw = 2.5f - 2.0f * (blending / 100.0f);',
    '    float ws = _powf(clampf((m - L) / m, 0.0f, 1.0f), pw), wh = _powf(clampf((L - m) / (1.0f - m), 0.0f, 1.0f), pw), wm = _fmaxf(0.0f, 1.0f - ws - wh);',
    '    float wt[4] = {ws, wm, wh, 1.0f}, gain[4] = {0.4f, 0.4f, 0.4f, 0.25f}, lgain[4] = {0.25f, 0.25f, 0.25f, 0.2f};',
    '    float gh[4] = {grade_shadows_h, grade_midtones_h, grade_highlights_h, grade_global_h};',
    '    float gs[4] = {grade_shadows_s, grade_midtones_s, grade_highlights_s, grade_global_s};',
    '    float gl[4] = {grade_shadows_l, grade_midtones_l, grade_highlights_l, grade_global_l};',
    '    for (int k = 0; k < 4; k++) {',
    '        if (gs[k] == 0.0f && gl[k] == 0.0f) continue;',
    '        float3 d = tintDir(gh[k]);',
    '        float S = gs[k] / 100.0f, Lm = gl[k] / 100.0f;',
    '        r += wt[k] * (S * gain[k] * d.x + Lm * lgain[k]);',
    '        g += wt[k] * (S * gain[k] * d.y + Lm * lgain[k]);',
    '        b += wt[k] * (S * gain[k] * d.z + Lm * lgain[k]);',
    '    }',
    '    // Calibrage : teinte des ombres.',
    '    if (shadowTint != 0.0f) {',
    '        float cl = clampf(L, 0.0f, 1.0f), sh = (1.0f - cl) * (1.0f - cl) * (shadowTint / 100.0f);',
    '        r += 0.04f * sh; g -= 0.08f * sh; b += 0.04f * sh;',
    '    }',
    '    // Presence : vibrance et saturation.',
    '    if (vibrance != 0.0f || saturation != 0.0f) {',
    '        float Y = luma(r, g, b), mx = _fmaxf(r, _fmaxf(g, b)), mn = _fminf(r, _fminf(g, b));',
    '        float sat = mx > 0.00001f ? clampf((mx - mn) / mx, 0.0f, 1.0f) : 0.0f, protect = 1.0f;',
    '        if (vibrance != 0.0f && mx - mn > 0.00001f) { float h = hueOf(r, g, b, mx, mx - mn); if (h < 50.0f || h > 345.0f) protect = 0.5f; }',
    '        float k = (1.0f + saturation / 100.0f) * (1.0f + (vibrance / 100.0f) * 0.8f * (1.0f - sat) * protect);',
    '        r = Y + (r - Y) * k; g = Y + (g - Y) * k; b = Y + (b - Y) * k;',
    '    }',
    '    r = clampf(r, 0.0f, 1.0f); g = clampf(g, 0.0f, 1.0f); b = clampf(b, 0.0f, 1.0f);',
    '    float a = clampf(amount, 0.0f, 100.0f) / 100.0f;',
    '    return make_float3(r0 + (r - r0) * a, g0 + (g - g0) * a, b0 + (b - b0) * a);',
    '}'
  ].join('\n');

  /* Histogramme RVB d'une image (comme celui de Lightroom), bins valeurs entre 0 et 1. */
  function histogram(px, bins) {
    bins = bins || 128;
    const h = { r: new Float32Array(bins), g: new Float32Array(bins), b: new Float32Array(bins) }, k = (bins - 1) / 255;
    for (let i = 0; i < px.length; i += 4) {
      h.r[Math.round(px[i] * k)]++; h.g[Math.round(px[i + 1] * k)]++; h.b[Math.round(px[i + 2] * k)]++;
    }
    let max = 1;
    ['r', 'g', 'b'].forEach(c => { for (let i = 1; i < bins - 1; i++) max = Math.max(max, h[c][i]); });
    ['r', 'g', 'b'].forEach(c => { for (let i = 0; i < bins; i++) h[c][i] = Math.min(1, h[c][i] / max); });
    return h;
  }

  // ---------------------------------------------------------------- looks fournis

  const LOOKS = [
    { id: 'clip', name: _T('Clip musical'), p: { temp: -8, contrast: 35, highlights: -35, shadows: 20, whites: 12, blacks: -20, vibrance: 25, saturation: -5, grading: { shadows: { h: 195, s: 65, l: -5 }, highlights: { h: 32, s: 55, l: 0 } }, balance: -10 } },
    { id: 'film', name: _T('Film chaud'), p: { temp: 22, tint: 6, contrast: -8, blacks: 18, saturation: -12, curve: { rgb: [[0, 0.07], [0.5, 0.52], [1, 0.96]] }, grading: { highlights: { h: 40, s: 25, l: 0 }, shadows: { h: 25, s: 12, l: 0 } } } },
    { id: 'bw', name: _T('Noir et blanc'), p: { saturation: -100, contrast: 35, blacks: -20, whites: 15, highlights: -10, hsl: { red: { h: 0, s: 0, l: 15 }, blue: { h: 0, s: 0, l: -20 } } } },
    { id: 'pastel', name: 'Pastel', p: { exposure: 0.25, contrast: -35, highlights: -20, shadows: 35, saturation: -25, vibrance: 15, curve: { rgb: [[0, 0.1], [1, 0.95]] }, grading: { global: { h: 330, s: 10, l: 0 } } } },
    { id: 'nuit', name: _T('Nuit bleue'), p: { temp: -35, exposure: -0.3, contrast: 20, saturation: -15, grading: { shadows: { h: 220, s: 60, l: -5 }, highlights: { h: 190, s: 25, l: 0 } } } },
    { id: 'cine', name: _T('Ciné désaturé'), p: { contrast: 18, highlights: -25, shadows: 10, saturation: -30, hsl: { orange: { h: 0, s: 20, l: 5 }, green: { h: -20, s: -45, l: -10 }, blue: { h: -15, s: -10, l: -10 } }, grading: { shadows: { h: 190, s: 25, l: 0 } } } },
    { id: 'vintage', name: _T('Été vintage'), p: { temp: 20, tint: 10, contrast: 15, vibrance: 10, saturation: -10, curve: { rgb: [[0, 0.06], [1, 0.96]], b: [[0, 0.16], [1, 0.84]], r: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]] }, grading: { midtones: { h: 45, s: 25, l: 0 } } } },
    { id: 'punch', name: 'Punchy', p: { contrast: 50, highlights: -25, shadows: 20, whites: 15, blacks: -15, vibrance: 50, saturation: 10 } }
  ];

  return { BANDS, WHEELS, defaults, normalize, compile, buildLut, toCube, toDCTL, sliderList, curveTable, histogram, tone, hsv2rgb, LOOKS, isIdentity };
});
