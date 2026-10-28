/* RR FX : analyse audio (sans DOM, testée sous Node) : temps forts, tempo, volume,
   et calage de deux enregistrements (synchronisation son caméra / musique). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXAudio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------------------------------------------------------------- filtres (biquads RBJ)

  function biquad(type, f0, sr, q) {
    q = q || Math.SQRT1_2;
    const w = 2 * Math.PI * Math.min(f0, sr * 0.45) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
    else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
    const a0 = 1 + al;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
  }

  function filter(x, c) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    return y;
  }

  const lowpass = (x, sr, f) => filter(x, biquad('lp', f, sr));
  const highpass = (x, sr, f) => filter(x, biquad('hp', f, sr));

  // ---------------------------------------------------------------- enveloppes

  // RMS par trame de 1/rate s (fenêtre de deux trames), en dB.
  function envelopeDb(x, sr, rate) {
    const hop = sr / rate, frames = Math.max(1, Math.floor(x.length / hop));
    const out = new Float32Array(frames);
    for (let n = 0; n < frames; n++) {
      const a = Math.max(0, Math.round(n * hop - hop / 2)), b = Math.min(x.length, Math.round(n * hop + hop * 1.5));
      let s = 0;
      for (let i = a; i < b; i++) s += x[i] * x[i];
      out[n] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-10);
    }
    return out;
  }

  // Force d'attaque : montée positive de l'enveloppe (dB), moyennée sur les bandes.
  function onsetFrom(bands) {
    const n = bands[0].length, o = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      let s = 0;
      for (const e of bands) s += Math.max(0, e[i] - e[i - 1]);
      o[i] = s / bands.length;
    }
    return o;
  }

  // Analyse complète d'un signal mono. rate = trames par seconde.
  function analyze(samples, sr, rate) {
    rate = rate || 100;
    const low = envelopeDb(lowpass(samples, sr, 150), sr, rate);
    const highSig = highpass(samples, sr, 2500);
    const high = envelopeDb(highSig, sr, rate);
    const mid = envelopeDb(lowpass(highpass(samples, sr, 150), sr, 2500), sr, rate);
    const full = envelopeDb(samples, sr, rate);
    return {
      rate, duration: samples.length / sr, full,
      onset: onsetFrom([low, mid, high]),
      kick: onsetFrom([low]),
      snare: onsetFrom([mid, high])
    };
  }

  // ---------------------------------------------------------------- pics (temps forts)

  function maxOf(a) { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

  // Pics de la courbe d'attaque au-dessus d'un seuil local (moyenne + delta × écart type).
  function pickPeaks(o, rate, opts) {
    opts = opts || {};
    const sens = clamp(opts.sensitivity == null ? 50 : opts.sensitivity, 0, 100);
    const minGap = Math.max(1, Math.round((opts.minGap == null ? 0.1 : opts.minGap) * rate));
    const W = Math.max(2, Math.round(0.75 * rate)), n = o.length;
    const ps = new Float64Array(n + 1), pq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { ps[i + 1] = ps[i] + o[i]; pq[i + 1] = pq[i] + o[i] * o[i]; }
    const top = maxOf(o);
    if (top <= 0) return [];
    const delta = 2.6 - 2.3 * sens / 100, floor = top * (0.12 - 0.1 * sens / 100);
    const cand = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(o[i] >= o[i - 1] && o[i] > o[i + 1]) || o[i] < floor) continue;
      const a = Math.max(0, i - W), b = Math.min(n, i + W + 1), c = b - a;
      const mean = (ps[b] - ps[a]) / c, sd = Math.sqrt(Math.max(0, (pq[b] - pq[a]) / c - mean * mean));
      if (o[i] > mean + delta * sd) cand.push(i);
    }
    cand.sort((x, y) => o[y] - o[x]);
    const taken = new Uint8Array(n), keep = [];
    for (const i of cand) {
      let free = true;
      for (let j = Math.max(0, i - minGap + 1); j < Math.min(n, i + minGap); j++) if (taken[j]) { free = false; break; }
      if (!free) continue;
      taken[i] = 1;
      keep.push(i);
    }
    keep.sort((x, y) => x - y);
    // L'enveloppe est centrée sur la trame : l'attaque se situe une demi-trame avant.
    return keep.map(i => ({ t: Math.max(0, (i - 0.5) / rate), s: o[i] / top }));
  }

  // ---------------------------------------------------------------- tempo

  function estimateTempo(o, rate, opts) {
    opts = opts || {};
    const minBpm = opts.min || 70, maxBpm = opts.max || 180, n = o.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += o[i];
    mean /= n || 1;
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = o[i] - mean;
    const lo = Math.max(2, Math.floor(rate * 60 / maxBpm)), hi = Math.min(n - 2, Math.ceil(rate * 60 / minBpm));
    if (hi <= lo) return null;
    const r = new Float64Array(hi + 2);
    let r0 = 0;
    for (let i = 0; i < n; i++) r0 += z[i] * z[i];
    for (let L = lo - 1; L <= hi + 1; L++) {
      let s = 0;
      for (let i = 0; i + L < n; i++) s += z[i] * z[i + L];
      r[L] = s / (n - L);
    }
    let best = lo, bestScore = -Infinity;
    for (let L = lo; L <= hi; L++) {
      const bpm = 60 * rate / L, prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      const sc = r[L] * prior;
      if (sc > bestScore) { bestScore = sc; best = L; }
    }
    const y0 = r[best - 1], y1 = r[best], y2 = r[best + 1], den = y0 - 2 * y1 + y2;
    const Lf = best + (den ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0);
    let phase = 0, phaseScore = -Infinity;
    for (let p = 0; p < Lf; p += 0.5) {
      let s = 0;
      for (let t = p; t < n; t += Lf) s += o[Math.round(t)] || 0;
      if (s > phaseScore) { phaseScore = s; phase = p; }
    }
    return { bpm: 60 * rate / Lf, period: Lf / rate, phase: phase / rate, confidence: r0 > 0 ? r[best] * n / r0 : 0 };
  }

  function gridTimes(tempo, t0, t1) {
    const out = [];
    if (!tempo || !(tempo.period > 0)) return out;
    let k = Math.ceil((t0 - tempo.phase) / tempo.period - 1e-9);
    for (let t = tempo.phase + k * tempo.period; t <= t1 + 1e-9; t = tempo.phase + (++k) * tempo.period) out.push(t);
    return out;
  }

  function snapToPeaks(times, peaks, tol) {
    return times.map(t => {
      let best = t, bd = tol;
      for (const p of peaks) { const d = Math.abs(p.t - t); if (d <= bd) { bd = d; best = p.t; } }
      return best;
    });
  }

  // Temps forts d'une analyse. mode : 'hits' (tous les coups), 'kicks' (grosse caisse),
  // 'snares' (caisse claire / charleston), 'tempo' (grille du tempo calée sur les coups).
  function detectBeats(an, opts) {
    opts = opts || {};
    const from = Math.max(0, opts.from || 0), to = Math.min(an.duration, opts.to == null ? an.duration : opts.to);
    let times, tempo = estimateTempo(an.onset, an.rate);
    const hits = pickPeaks(an.onset, an.rate, opts);
    if (opts.mode === 'kicks') times = pickPeaks(an.kick, an.rate, opts).map(p => p.t);
    else if (opts.mode === 'snares') times = pickPeaks(an.snare, an.rate, opts).map(p => p.t);
    else if (opts.mode === 'tempo') times = snapToPeaks(gridTimes(tempo, from, to), hits, 0.06);
    else times = hits.map(p => p.t);
    times = times.filter(t => t >= from - 1e-9 && t <= to + 1e-9);
    const every = Math.max(1, Math.round(opts.every || 1));
    if (every > 1) times = times.filter((t, i) => i % every === 0);
    return { times, bpm: tempo ? Math.round(tempo.bpm * 10) / 10 : null, tempo };
  }

  // ---------------------------------------------------------------- volume

  // Volume ressenti, de 0 (passages calmes) à 1 (passages les plus forts).
  function loudnessCurve(an) {
    const e = an.full, n = e.length, w = Math.max(1, Math.round(0.2 * an.rate)), sm = new Float32Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += e[i];
      if (i >= w) s -= e[i - w];
      sm[i] = s / Math.min(i + 1, w);
    }
    const sorted = Float32Array.from(sm).sort();
    const lo = sorted[Math.floor(n * 0.1)], hi = sorted[Math.min(n - 1, Math.floor(n * 0.97))];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = hi > lo ? clamp((sm[i] - lo) / (hi - lo), 0, 1) : 0.5;
    return { rate: an.rate, values: out };
  }

  function loudnessAt(curve, t, win) {
    const a = Math.max(0, Math.floor(t * curve.rate)), b = Math.min(curve.values.length - 1, Math.ceil((t + (win || 0.15)) * curve.rate));
    let m = 0;
    for (let i = a; i <= b; i++) m = Math.max(m, curve.values[i]);
    return a > curve.values.length - 1 ? 0.5 : m;
  }

  // Multiplicateur d'intensité : influence 0 = aucun effet, 1 = de ×0,4 (calme) à ×1,6 (fort).
  function intensityFactor(loud, influence) {
    return 1 + clamp(influence, 0, 1) * (clamp(loud, 0, 1) - 0.5) * 1.2;
  }

  // ---------------------------------------------------------------- synchronisation

  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  // Courbes utilisées pour caler deux enregistrements : les attaques par bande (graves,
  // médiums, aigus), 200 trames par seconde. Comparer les bandes séparément évite de
  // confondre une grosse caisse et un charleston décalés d'un demi-temps ; les attaques
  // résistent au volume, à l'égalisation et au bruit du micro de la caméra.
  function syncCurve(samples, sr) {
    const rate = 200;
    const low = envelopeDb(lowpass(samples, sr, 150), sr, rate);
    const mid = envelopeDb(lowpass(highpass(samples, sr, 150), sr, 2500), sr, rate);
    const high = envelopeDb(highpass(samples, sr, 2500), sr, rate);
    return { rate, bands: [onsetFrom([low]), onsetFrom([mid]), onsetFrom([high])] };
  }

  // Courbe d'un long enregistrement lu par morceaux : chaque morceau est lu avec `skip`
  // secondes d'avance (le temps que les filtres se stabilisent), retirées ici, puis les
  // morceaux sont mis bout à bout.
  function syncCurvePart(samples, sr, skip) {
    const c = syncCurve(samples, sr), k = Math.round((skip || 0) * c.rate);
    return { rate: c.rate, bands: c.bands.map(b => b.subarray(Math.min(k, b.length))) };
  }
  function joinCurves(parts) {
    const rate = parts.length ? parts[0].rate : 200;
    const bands = [0, 1, 2].map(k => {
      const n = parts.reduce((s, p) => s + p.bands[k].length, 0), out = new Float32Array(n);
      let o = 0;
      parts.forEach(p => { out.set(p.bands[k], o); o += p.bands[k].length; });
      return out;
    });
    return { rate, bands };
  }

  // Où l'extrait `a` (son caméra) se trouve dans `b` (musique). Renvoie le décalage en
  // secondes (temps dans b = temps dans a + offset), un score (0-1) et la netteté du pic.
  function findOffset(a, b) {
    const rate = a.rate, n = a.bands[0].length, m = b.bands[0].length;
    if (n < rate || m < rate) return null;
    let N = 1;
    while (N < n + m) N <<= 1;
    const accR = new Float64Array(N), accI = new Float64Array(N), yy = new Float64Array(N + 1);
    let nx = 0;
    for (let k = 0; k < a.bands.length; k++) {
      const x = a.bands[k], y = b.bands[k];
      let mx = 0, my = 0;
      for (let i = 0; i < n; i++) mx += x[i];
      for (let i = 0; i < m; i++) my += y[i];
      mx /= n; my /= m;
      const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
      for (let i = 0; i < n; i++) { ar[i] = x[i] - mx; nx += ar[i] * ar[i]; }
      for (let i = 0; i < m; i++) br[n + i] = y[i] - my; // b décalé de n : les décalages négatifs restent positifs
      for (let i = 0; i < N; i++) { const v = br[i]; yy[i + 1] += v * v; }
      fft(ar, ai, false);
      fft(br, bi, false);
      for (let i = 0; i < N; i++) {
        accR[i] += ar[i] * br[i] + ai[i] * bi[i];
        accI[i] += ar[i] * bi[i] - ai[i] * br[i];
      }
    }
    for (let i = 0; i < N; i++) yy[i + 1] += yy[i];
    fft(accR, accI, true);
    // accR[k] = Σ x[i]·y'[i+k] (toutes bandes) avec y' = y décalé de n ; décalage réel = k - n.
    const minOverlap = Math.floor(n * 0.6), score = new Float64Array(N);
    let best = -1, bestV = -Infinity;
    for (let k = 0; k + n <= N; k++) {
      const lag = k - n, overlap = Math.min(n, m - lag) - Math.max(0, -lag);
      if (overlap < minOverlap) continue;
      const e = yy[k + n] - yy[k];
      const v = e > 0 && nx > 0 ? accR[k] / Math.sqrt(nx * e) : 0;
      score[k] = v;
      if (v > bestV) { bestV = v; best = k; }
    }
    if (best < 0) return null;
    let second = 0;
    const excl = Math.round(0.4 * rate);
    for (let k = 0; k + n <= N; k++) if (Math.abs(k - best) > excl && score[k] > second) second = score[k];
    const y0 = score[best - 1] || 0, y1 = score[best], y2 = score[best + 1] || 0, den = y0 - 2 * y1 + y2;
    const frac = den ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
    return { offset: (best - n + frac) / rate, score: bestV, clarity: second > 0 ? bestV / second : 10 };
  }

  return {
    biquad, filter, lowpass, highpass, envelopeDb, analyze, pickPeaks, estimateTempo, gridTimes, snapToPeaks,
    detectBeats, loudnessCurve, loudnessAt, intensityFactor, fft, syncCurve, syncCurvePart, joinCurves, findOffset
  };
});
