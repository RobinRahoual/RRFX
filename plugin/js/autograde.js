/* RR FX : analyse d'image pour l'étalonnage automatique. Exposition et balance des blancs
   d'un plan, et raccord d'un plan sur un plan de référence (une caméra sur l'autre). Le
   résultat est une fonction couleur, transformée en LUT .cube. Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXAuto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lin = v => Math.pow(clamp(v, 0, 1), 2.4); // signal Rec.709 (BT.1886) → lumière
  const disp = v => Math.pow(Math.max(0, v), 1 / 2.4);
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ZONES = ['shadows', 'mids', 'highs'];
  const zoneOf = y => (y < 0.33 ? 0 : y < 0.66 ? 1 : 2);

  /* Statistiques d'une image RVBA (Uint8ClampedArray) : histogramme de la luminance, moyenne
     des tons neutres (en lumière), chroma moyenne et écart par zone. Sous-échantillonné. */
  function analyze(px, maxSamples) {
    const n = px.length / 4, step = Math.max(1, Math.floor(n / (maxSamples || 60000)));
    const hist = new Float64Array(256), neutral = [0, 0, 0], zones = ZONES.map(() => ({ cb: 0, cr: 0, w: 0 }));
    let count = 0, nn = 0, cb = 0, cr = 0, cb2 = 0, cr2 = 0;
    for (let i = 0; i < n; i += step) {
      const o = i * 4, r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255, y = luma(r, g, b);
      const u = (b - y) / 1.8556, v = (r - y) / 1.5748;
      hist[Math.min(255, Math.round(y * 255))]++;
      cb += u; cr += v; cb2 += u * u; cr2 += v * v; count++;
      const z = zones[zoneOf(y)];
      z.cb += u; z.cr += v; z.w++;
      // Tons neutres (gris, blancs non brûlés) pour la balance des blancs.
      const mx = Math.max(r, g, b);
      if (y > 0.12 && y < 0.88 && mx < 0.97 && (mx - Math.min(r, g, b)) / mx < 0.3) {
        neutral[0] += lin(r); neutral[1] += lin(g); neutral[2] += lin(b); nn++;
      }
    }
    for (let i = 0; i < 256; i++) hist[i] /= count || 1;
    const mc = count || 1, mcb = cb / mc, mcr = cr / mc;
    return {
      hist, count, neutral: nn ? neutral.map(v => v / nn) : null, neutralShare: nn / mc,
      cb: mcb, cr: mcr, sd: Math.sqrt(Math.max(1e-8, (cb2 + cr2) / mc - mcb * mcb - mcr * mcr)),
      zones: zones.map(z => (z.w ? { cb: z.cb / z.w, cr: z.cr / z.w, w: z.w / mc } : { cb: mcb, cr: mcr, w: 0 }))
    };
  }

  // Plusieurs images d'une même caméra → une seule statistique (moyenne pondérée).
  function merge(list) {
    list = list.filter(Boolean);
    if (list.length === 1) return list[0];
    const hist = new Float64Array(256), neutral = [0, 0, 0], zones = ZONES.map(() => ({ cb: 0, cr: 0, w: 0 }));
    let cb = 0, cr = 0, sd = 0, nw = 0, ns = 0;
    list.forEach(s => {
      for (let i = 0; i < 256; i++) hist[i] += s.hist[i] / list.length;
      cb += s.cb / list.length; cr += s.cr / list.length; sd += s.sd / list.length; ns += s.neutralShare / list.length;
      if (s.neutral) { for (let c = 0; c < 3; c++) neutral[c] += s.neutral[c]; nw++; }
      s.zones.forEach((z, k) => { zones[k].cb += z.cb * z.w; zones[k].cr += z.cr * z.w; zones[k].w += z.w; });
    });
    return {
      hist, count: list.reduce((a, s) => a + s.count, 0), neutral: nw ? neutral.map(v => v / nw) : null, neutralShare: ns, cb, cr, sd,
      zones: zones.map(z => (z.w ? { cb: z.cb / z.w, cr: z.cr / z.w, w: z.w / list.length } : { cb, cr, w: 0 }))
    };
  }

  function percentile(hist, p) {
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= p) return i / 255; }
    return 1;
  }

  // ---------------------------------------------------------------- exposition et balance

  /* Réglages automatiques d'un plan. o : { exposure, wb, levels (booléens), strength 0..1,
     target (gris visé, 0,42 par défaut) }. Les corrections restent bornées (±1,5 IL, gains
     0,75 à 1,33) : un plan sombre voulu ou une lumière chaude ne sont pas « réparés » à fond. */
  function autoParams(st, o) {
    o = Object.assign({ exposure: true, wb: true, levels: true, strength: 1, target: 0.42 }, o || {});
    const k = clamp(o.strength, 0, 1), out = { gain: [1, 1, 1], ev: 0, black: 0, white: 1 };
    if (o.wb && st.neutral && st.neutralShare > 0.02) {
      const m = st.neutral, y = luma(m[0], m[1], m[2]);
      out.gain = m.map(c => 1 + (clamp(y / Math.max(1e-6, c), 0.75, 1.33) - 1) * k);
    }
    if (o.exposure) {
      const med = percentile(st.hist, 0.5), hi = percentile(st.hist, 0.985);
      let ev = Math.log2(lin(o.target) / Math.max(1e-4, lin(Math.max(0.02, med))));
      ev = clamp(ev, -1.5, 1.5) * k;
      // Sans brûler les hautes lumières qui ne l'étaient pas.
      if (ev > 0 && hi < 0.98) ev = Math.min(ev, Math.max(0, Math.log2(1 / Math.max(1e-4, lin(hi)))));
      out.ev = ev;
    }
    if (o.levels) {
      const e = Math.pow(2, out.ev), lo = disp(lin(percentile(st.hist, 0.004)) * e), top = disp(lin(percentile(st.hist, 0.996)) * e);
      if (lo > 0.035) out.black = clamp(lo - 0.02, 0, 0.08) * k;
      if (top < 0.9) out.white = 1 - clamp(0.98 - top, 0, 0.12) * k;
    }
    return out;
  }

  function correction(p) {
    const e = Math.pow(2, p.ev || 0), g = p.gain || [1, 1, 1], b0 = p.black || 0, w0 = p.white || 1, span = Math.max(0.2, w0 - b0);
    return (r, gr, b) => [r, gr, b].map((v, c) => clamp((disp(lin(v) * g[c] * e) - b0) / span, 0, 1));
  }

  // ---------------------------------------------------------------- raccord sur une référence

  /* Raccord d'une caméra sur une autre : courbe de luminance par égalisation des histogrammes
     (lissée, monotone), chroma recentrée et mise à l'échelle, teinte corrigée par zone (ombres,
     tons moyens, hautes lumières). strength 0..1 dose le tout. */
  function matchParams(src, ref, strength) {
    const k = clamp(strength === undefined ? 1 : strength, 0, 1);
    const cdf = h => { const c = new Float64Array(256); let a = 0; for (let i = 0; i < 256; i++) { a += h[i]; c[i] = a; } return c; };
    const cs = cdf(src.hist), cr = cdf(ref.hist), raw = new Float64Array(256);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      while (j < 255 && cr[j] < cs[i]) j++;
      raw[i] = j / 255;
    }
    // Lissage, puis pente bornée et sens croissant (pas d'aplats ni d'inversions).
    const curve = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      let s = 0, w = 0;
      for (let d = -8; d <= 8; d++) { const q = clamp(i + d, 0, 255); s += raw[q]; w++; }
      curve[i] = s / w;
    }
    let prev = 0;
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let y = x + (curve[i] - x) * k;
      if (i) y = clamp(y, prev + 0.15 / 255, prev + 3 / 255);
      curve[i] = prev = clamp(y, 0, 1);
    }
    const scale = 1 + (clamp(ref.sd / Math.max(1e-4, src.sd), 0.6, 1.6) - 1) * k;
    const shift = { cb: (ref.cb - src.cb * scale) * k, cr: (ref.cr - src.cr * scale) * k };
    const zones = src.zones.map((z, i) => ({
      cb: ((ref.zones[i].cb - ref.cb) - (z.cb - src.cb) * scale) * k,
      cr: ((ref.zones[i].cr - ref.cr) - (z.cr - src.cr) * scale) * k
    }));
    return { curve: Array.from(curve), scale, shift, zones };
  }

  function matcher(p) {
    const C = p.curve, at = y => { const x = clamp(y, 0, 1) * 255, i = Math.min(254, Math.floor(x)), f = x - i; return C[i] + (C[i + 1] - C[i]) * f; };
    // Poids des zones, en fondu (pas de cassure entre ombres et tons moyens).
    const wz = y => { const s = clamp(1 - y / 0.33, 0, 1), h = clamp((y - 0.66) / 0.34, 0, 1); return [s, Math.max(0, 1 - s - h), h]; };
    return (r, g, b) => {
      const y = luma(r, g, b), u = (b - y) / 1.8556, v = (r - y) / 1.5748, y2 = at(y), w = wz(y2);
      const u2 = u * p.scale + p.shift.cb + w[0] * p.zones[0].cb + w[1] * p.zones[1].cb + w[2] * p.zones[2].cb;
      const v2 = v * p.scale + p.shift.cr + w[0] * p.zones[0].cr + w[1] * p.zones[1].cr + w[2] * p.zones[2].cr;
      const R = y2 + 1.5748 * v2, B = y2 + 1.8556 * u2, G = (y2 - 0.2126 * R - 0.0722 * B) / 0.7152;
      return [clamp(R, 0, 1), clamp(G, 0, 1), clamp(B, 0, 1)];
    };
  }

  // ---------------------------------------------------------------- LUT et aperçu

  function lutOf(fn, size) {
    const N = size || 33, data = new Float32Array(N * N * N * 3);
    let o = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const v = fn(r / (N - 1), g / (N - 1), b / (N - 1));
      data[o++] = v[0]; data[o++] = v[1]; data[o++] = v[2];
    }
    return { title: '', size: N, dim: 3, min: [0, 0, 0], max: [1, 1, 1], data };
  }

  // Résumé lisible d'une correction auto (pour le journal).
  function describe(p) {
    const parts = [];
    if (Math.abs(p.ev) >= 0.05) parts.push((p.ev > 0 ? '+' : '') + p.ev.toFixed(1).replace('.', ',') + _T(' IL'));
    const warm = p.gain[0] / p.gain[2];
    if (Math.abs(warm - 1) > 0.03) parts.push(warm > 1 ? _T('réchauffé') : 'refroidi');
    if (p.black > 0.005 || p.white < 0.995) parts.push('niveaux');
    return parts.join(', ') || _T('déjà juste');
  }

  return { analyze, merge, percentile, autoParams, correction, matchParams, matcher, lutOf, describe, lin, disp };
});
