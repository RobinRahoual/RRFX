/* RR FX : détection de la voix avec Silero VAD (petit réseau de neurones, 310 000 poids, licence MIT),
   sans dépendance. Bien plus juste qu'un seuil de volume : la musique, le vent, la clim ou un
   bruit de fond ne sont pas pris pour de la voix, et une voix basse n'est pas prise pour un blanc.
   - probs(samples 16 kHz) : la probabilité de voix toutes les 32 ms (morceaux de 512 échantillons,
     avec les 64 précédents en contexte, comme le modèle officiel) ;
   - speech(probs) : les passages parlés (même réglages que get_speech_timestamps de Silero) ;
   - silences(...) : les blancs entre eux, pour la coupe des silences.
   La fabrique n'utilise rien d'extérieur : elle tourne aussi dans un Worker (parole.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXVad = factory();
})(typeof self !== 'undefined' ? self : this, function sileroFactory() {
  'use strict';

  const CHUNK = 512, CTX = 64, SR = 16000;
  let net = null;

  // float16 → float32.
  function half(u) {
    const s = u & 0x8000 ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
    if (e === 0) return s * f * 5.960464477539063e-8;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * (1 + f / 1024) * Math.pow(2, e - 15);
  }
  function load(model) {
    if (net && net.model === model) return net;
    const bin = typeof atob === 'function' ? atob(model.weights) : Buffer.from(model.weights, 'base64').toString('binary');
    const u = new Uint16Array(bin.length >> 1);
    for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    const w = {};
    Object.keys(model.tensors).forEach(k => {
      const t = model.tensors[k], a = new Float32Array(t.n);
      for (let i = 0; i < t.n; i++) a[i] = half(u[t.o + i]);
      w[k] = a;
    });
    net = { model, w };
    return net;
  }

  // FFT de 256 points (radix 2), fenêtre de Hann périodique : la STFT du modèle.
  const N = 256, HANN = new Float32Array(N), COS = new Float32Array(N / 2), SIN = new Float32Array(N / 2), REV = new Uint16Array(N);
  for (let k = 0; k < N; k++) {
    HANN[k] = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / N);
    let r = 0;
    for (let b = 0; b < 8; b++) r |= ((k >> b) & 1) << (7 - b);
    REV[k] = r;
  }
  for (let k = 0; k < N / 2; k++) { COS[k] = Math.cos(2 * Math.PI * k / N); SIN[k] = -Math.sin(2 * Math.PI * k / N); }
  const fre = new Float32Array(N), fim = new Float32Array(N);
  // Module des 129 fréquences de x[o .. o + 256] dans mag[f * stride + t].
  function spectrum(x, o, mag, t, stride) {
    for (let k = 0; k < N; k++) { fre[REV[k]] = x[o + k] * HANN[k]; fim[REV[k]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half, c = COS[j * step], s = SIN[j * step];
          const tr = fre[b] * c - fim[b] * s, ti = fre[b] * s + fim[b] * c;
          fre[b] = fre[a] - tr; fim[b] = fim[a] - ti;
          fre[a] += tr; fim[a] += ti;
        }
      }
    }
    for (let f = 0; f <= N / 2; f++) mag[f * stride + t] = Math.sqrt(fre[f] * fre[f] + fim[f] * fim[f]);
  }

  // Convolution 1D (noyau 3, marge 1) + ReLU : in [cin][T] → out [cout][Tout].
  function conv3(inp, cin, T, wt, b, cout, stride) {
    const To = Math.floor((T - 1) / stride) + 1, out = new Float32Array(cout * To);
    for (let o = 0; o < cout; o++) {
      for (let t = 0; t < To; t++) out[o * To + t] = b[o];
      for (let i = 0; i < cin; i++) {
        const wo = (o * cin + i) * 3, w0 = wt[wo], w1 = wt[wo + 1], w2 = wt[wo + 2], io = i * T;
        for (let t = 0; t < To; t++) {
          const x = t * stride - 1 + io;
          let s = w1 * inp[x + 1];
          if (x >= io) s += w0 * inp[x];
          if (x + 2 < io + T) s += w2 * inp[x + 2];
          out[o * To + t] += s;
        }
      }
      for (let t = 0; t < To; t++) if (out[o * To + t] < 0) out[o * To + t] = 0;
    }
    return { out, T: To };
  }
  const sig = x => 1 / (1 + Math.exp(-x));

  /* Un morceau de 576 échantillons (64 de contexte + 512) → probabilité de voix. st : { h, c }
     (état du LSTM, gardé d'un morceau à l'autre). */
  function step(n, x, st) {
    const w = n.w, padded = new Float32Array(CHUNK + CTX + 64);
    padded.set(x);
    // Marge « miroir » de 64 à droite (comme le modèle).
    for (let j = 1; j <= 64; j++) padded[CHUNK + CTX - 1 + j] = x[CHUNK + CTX - 1 - j];
    // STFT : fenêtres de 256 au pas de 128 → 4 instants ; module des 129 fréquences.
    const T = 4, mag = new Float32Array(129 * T);
    for (let t = 0; t < T; t++) spectrum(padded, t * 128, mag, t, T);
    let e = conv3(mag, 129, T, w.c0w, w.c0b, 128, 1);
    e = conv3(e.out, 128, e.T, w.c1w, w.c1b, 64, 2);
    e = conv3(e.out, 64, e.T, w.c2w, w.c2b, 64, 2);
    e = conv3(e.out, 64, e.T, w.c3w, w.c3b, 128, 1);
    const v = e.out; // 128 valeurs (un seul instant)
    // LSTM (portes i, f, g, o comme PyTorch).
    const g = new Float32Array(512);
    for (let r = 0; r < 512; r++) {
      let s = w.bih[r] + w.bhh[r];
      const a = r * 128;
      for (let k = 0; k < 128; k++) s += w.wih[a + k] * v[k] + w.whh[a + k] * st.h[k];
      g[r] = s;
    }
    let out = w.ob[0];
    for (let k = 0; k < 128; k++) {
      const c = sig(g[128 + k]) * st.c[k] + sig(g[k]) * Math.tanh(g[256 + k]);
      st.c[k] = c;
      st.h[k] = sig(g[384 + k]) * Math.tanh(c);
      if (st.h[k] > 0) out += w.ow[k] * st.h[k];
    }
    return sig(out);
  }

  // Son mono 16 kHz → probabilité de voix par morceau de 32 ms. onStep(i, n) : avancement.
  function probs(model, samples, onStep) {
    const n = load(model), count = Math.ceil(samples.length / CHUNK), out = new Float32Array(count);
    const st = { h: new Float32Array(128), c: new Float32Array(128) }, x = new Float32Array(CHUNK + CTX);
    for (let i = 0; i < count; i++) {
      // Contexte : les 64 derniers échantillons du morceau précédent (zéros au début).
      x.copyWithin(0, CHUNK, CHUNK + CTX);
      if (i === 0) x.fill(0, 0, CTX);
      x.fill(0, CTX);
      x.set(samples.subarray(i * CHUNK, Math.min(samples.length, (i + 1) * CHUNK)), CTX);
      out[i] = step(n, x, st);
      if (onStep && i % 500 === 0) onStep(i, count);
    }
    return out;
  }

  /* Passages parlés (s), comme get_speech_timestamps de Silero : seuil threshold, fin de passage
     sous threshold - 0,15 pendant minSilence, passages de moins de minSpeech ignorés. */
  function speech(p, opts) {
    const o = Object.assign({ threshold: 0.5, minSpeech: 0.25, minSilence: 0.1 }, opts || {});
    const dt = CHUNK / SR, neg = Math.max(o.threshold - 0.15, 0.01), out = [];
    let on = false, start = 0, tempEnd = -1;
    for (let i = 0; i < p.length; i++) {
      const t = i * dt;
      if (p[i] >= o.threshold) { tempEnd = -1; if (!on) { on = true; start = t; } continue; }
      if (on && p[i] < neg) {
        if (tempEnd < 0) tempEnd = t;
        if (t + dt - tempEnd >= o.minSilence) {
          if (tempEnd - start >= o.minSpeech) out.push({ a: start, b: tempEnd });
          on = false; tempEnd = -1;
        }
      }
    }
    if (on && p.length * dt - start >= o.minSpeech) out.push({ a: start, b: p.length * dt });
    return out;
  }

  /* Blancs entre les passages parlés, sur [0, dur] s : ceux d'au moins minSilence, raccourcis de
     pad de chaque côté (la respiration et l'attaque des mots restent). */
  function silences(segs, dur, opts) {
    const o = Object.assign({ minSilence: 0.5, pad: 0.12 }, opts || {}), out = [];
    let t = 0;
    segs.concat([{ a: dur, b: dur }]).forEach(s => {
      const a = t === 0 ? 0 : t + o.pad, b = s.a >= dur ? dur : s.a - o.pad;
      if (s.a - t >= o.minSilence && b - a > 0.05) out.push({ a, b });
      t = Math.max(t, s.b);
    });
    return out;
  }

  // Seuil selon la sensibilité de la coupe des silences (douce : moins de coupes).
  const THRESHOLDS = { soft: 0.35, normal: 0.5, strong: 0.65 };

  return { load, probs, speech, silences, THRESHOLDS, CHUNK, SR, factory: sileroFactory };
});
