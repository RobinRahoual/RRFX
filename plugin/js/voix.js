/* RR FX : la voix. Sonie (LUFS, norme EBU R128 / ITU BS.1770) pour mettre chaque plan au
   même niveau (-14 LUFS pour YouTube et les réseaux), « euh » et hésitations repérés dans le son,
   et courbe de volume de la musique qui baisse sous la voix (ducking). Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXVoix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- sonie

  // Filtre biquad (forme directe I) appliqué en place.
  function biquad(x, b0, b1, b2, a1, a2) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
  }

  // Pondération K de BS.1770 (étagère aiguë + passe-haut), pour toute fréquence d'échantillonnage.
  function kWeight(x, sr) {
    const y = Float32Array.from(x);
    let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    biquad(y, (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
    K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773;
    a0 = 1 + K / Q + K * K;
    return biquad(y, 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  }

  /* Sonie intégrée d'un son mono (LUFS) et crête (dBFS). → { lufs, peak } ; lufs = -Infinity
     pour un silence. */
  function loudness(x, sr) {
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const y = kWeight(x, sr), n = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), blocks = [];
    for (let a = 0; a + n <= y.length; a += hop) {
      let s = 0;
      for (let i = a; i < a + n; i++) s += y[i] * y[i];
      blocks.push(s / n);
    }
    if (!blocks.length) { let s = 0; for (let i = 0; i < y.length; i++) s += y[i] * y[i]; blocks.push(s / Math.max(1, y.length)); }
    const L = ms => -0.691 + 10 * Math.log10(ms + 1e-20);
    const abs = blocks.filter(b => L(b) > -70);
    if (!abs.length) return { lufs: -Infinity, peak: 20 * Math.log10(peak + 1e-12) };
    const rel = L(abs.reduce((s, b) => s + b, 0) / abs.length) - 10;
    const gated = abs.filter(b => L(b) > rel);
    return { lufs: L(gated.reduce((s, b) => s + b, 0) / gated.length), peak: 20 * Math.log10(peak + 1e-12) };
  }

  /* Gain (dB) pour amener une voix à `target` LUFS sans dépasser `ceiling` dBFS de crête. */
  function gainFor(m, target, ceiling) {
    const t = target == null ? -14 : target, c = ceiling == null ? -1 : ceiling;
    if (!isFinite(m.lufs)) return { gain: 0, limited: false, silent: true };
    let gain = t - m.lufs, limited = false;
    if (m.peak + gain > c) { gain = c - m.peak; limited = true; }
    return { gain: Math.round(gain * 10) / 10, limited, silent: false };
  }

  // ---------------------------------------------------------------- « euh »

  // Hauteur (Hz) et netteté (0 à 1) d'un bout de son, par autocorrélation normalisée.
  function pitchOf(x, a, n, sr) {
    const lo = Math.floor(sr / 400), hi = Math.ceil(sr / 70);
    let e0 = 0;
    for (let i = a; i < a + n; i++) e0 += x[i] * x[i];
    if (e0 <= 1e-9) return { f: 0, clarity: 0 };
    let best = 0, lag = 0;
    for (let L = lo; L <= hi; L++) {
      let r = 0, e1 = 0;
      for (let i = a; i < a + n; i++) { r += x[i] * x[i + L]; e1 += x[i + L] * x[i + L]; }
      const c = r / Math.sqrt(e0 * e1 + 1e-12);
      if (c > best) { best = c; lag = L; }
    }
    return { f: lag ? sr / lag : 0, clarity: best };
  }

  /* « Euh » et hésitations dans un son mono : un bout de voix isolé entre deux petites pauses,
     court (0,2 à 1,3 s), voisé d'un bout à l'autre, d'une hauteur et d'un volume qui ne bougent
     presque pas (une voyelle tenue). opts.level : soft | normal | strong.
     → [{ a, b }] (s, dans le son). */
  function fillers(x, sr, opts) {
    const o = Object.assign({ level: 'normal', pad: 0.03 }, opts || {});
    const tol = { soft: { pitch: 0.6, vol: 3.5, voiced: 0.9 }, normal: { pitch: 0.9, vol: 4.5, voiced: 0.85 }, strong: { pitch: 1.3, vol: 6, voiced: 0.75 } }[o.level] || {};
    // Son ramené à 8 kHz pour l'analyse de hauteur.
    const step = Math.max(1, Math.round(sr / 8000)), rs = sr / step, y = new Float32Array(Math.floor(x.length / step));
    for (let i = 0; i < y.length; i++) { let s = 0; for (let k = 0; k < step; k++) s += x[i * step + k]; y[i] = s / step; }
    // Niveau par tranche de 10 ms ; voix = au-dessus d'un seuil entre le fond et la voix.
    const hop = Math.round(0.01 * rs), db = [];
    for (let a = 0; a + hop <= y.length; a += hop) { let s = 0; for (let i = a; i < a + hop; i++) s += y[i] * y[i]; db.push(10 * Math.log10(s / hop + 1e-12)); }
    const sorted = db.slice().sort((p, q) => p - q), floor = sorted[Math.floor(sorted.length * 0.1)] || -100, voice = sorted[Math.floor(sorted.length * 0.95)] || -100;
    if (voice - floor < 12) return [];
    const thr = floor + (voice - floor) * 0.35, on = db.map(v => v > thr);
    // Bouts de voix séparés par au moins 120 ms de pause.
    const segs = [];
    for (let i = 0; i < on.length;) {
      if (!on[i]) { i++; continue; }
      let j = i, quiet = 0;
      while (j < on.length && quiet < 12) { quiet = on[j] ? 0 : quiet + 1; j++; }
      segs.push([i, j - quiet]);
      i = j;
    }
    const out = [], win = Math.round(0.04 * rs), maxLag = Math.ceil(rs / 70);
    segs.forEach(([i, j]) => {
      const dur = (j - i) * 0.01;
      if (dur < 0.2 || dur > 1.3) return;
      const f = [], v = [];
      let voiced = 0, total = 0;
      for (let k = i; k < j; k += 2) {
        const a = k * hop;
        if (a + win + maxLag >= y.length) break;
        total++;
        const p = pitchOf(y, a, win, rs);
        if (p.clarity > 0.6 && p.f > 70) { voiced++; f.push(12 * Math.log2(p.f / 100)); v.push(db[k]); }
      }
      if (!total || voiced / total < tol.voiced || f.length < 4) return;
      const sd = a => { const m = a.reduce((s, q) => s + q, 0) / a.length; return Math.sqrt(a.reduce((s, q) => s + (q - m) * (q - m), 0) / a.length); };
      // Le début et la fin d'un « euh » bougent un peu : on juge sur le cœur.
      const core = a => a.slice(Math.floor(a.length * 0.15), Math.ceil(a.length * 0.85));
      if (sd(core(f)) > tol.pitch || sd(core(v)) > tol.vol) return;
      out.push({ a: Math.max(0, i * 0.01 - o.pad), b: j * 0.01 + o.pad });
    });
    return out;
  }

  // ---------------------------------------------------------------- ducking

  /* Images clés de volume (gain en dB par rapport au niveau actuel) pour baisser la musique
     pendant que l'on parle. speech : [{ a, b }] (s) ; opts : depth (dB), attack, release (s),
     hold (pauses plus courtes : la musique reste basse), from, to (limites du clip). */
  function duckKeys(speech, opts) {
    const o = Object.assign({ depth: 12, attack: 0.25, release: 0.5, hold: 0.9, from: -Infinity, to: Infinity }, opts || {});
    const segs = [];
    speech.slice().sort((p, q) => p.a - q.a).forEach(r => {
      const l = segs[segs.length - 1];
      if (l && r.a - l.b < Math.max(o.hold, o.attack + o.release)) l.b = Math.max(l.b, r.b); else segs.push({ a: r.a, b: r.b });
    });
    const keys = [];
    segs.forEach(s => {
      if (s.b < o.from || s.a > o.to) return;
      const pts = [[s.a - o.attack, 0], [s.a, -o.depth], [s.b, -o.depth], [s.b + o.release, 0]];
      pts.forEach(([t, g]) => { if (t >= o.from && t <= o.to) keys.push([Math.round(t * 1000) / 1000, g]); });
      // Un clip qui commence ou finit pendant la voix : déjà bas à son bord.
      if (s.a - o.attack < o.from && s.b > o.from) keys.unshift([o.from, -o.depth]);
      if (s.b + o.release > o.to && s.a < o.to) keys.push([o.to, -o.depth]);
    });
    return keys.sort((p, q) => p[0] - q[0]).filter((k, i, a) => !i || k[0] > a[i - 1][0]);
  }

  /* Valeur du réglage « Niveau » de Premiere (0 à 1, 1 = +15 dB) ↔ dB. */
  const levelToDb = v => 20 * Math.log10(Math.max(1e-9, v)) + 15;
  const dbToLevel = d => Math.pow(10, (d - 15) / 20);

  return { kWeight, loudness, gainFor, fillers, duckKeys, levelToDb, dbToLevel };
});
