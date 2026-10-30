/* RR FX : son, calculs sans DOM (testés sous Node).
   - drops : les moments où la musique « tombe » (calme puis fort d'un coup), pour y caler un
     riser qui monte jusqu'au drop.
   - reverbTail : la queue de réverb d'une fin de musique coupée (la dernière note qui résonne au
     lieu de s'arrêter net), fabriquée par une réverb à filtres (type Freeverb).
   - breaths, clicks : respirations et petits clics de bouche dans une voix, à baisser.
   - duckKeys : plages à baisser → images clés de volume [temps, dB]. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXSonPlus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const mean = (a, i0, i1) => { let s = 0, n = 0; for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { s += a[i]; n++; } return n ? s / n : 0; };

  /* Drops dans une courbe de volume ressenti (0 à 1, rate valeurs/s). → [{ t, strength }] (s,
     temps de la courbe). Un drop : nettement plus fort sur les 2 s qui suivent que sur les 4 s
     d'avant. opts.beats : temps forts pour caler le drop dessus ; opts.gap : écart minimum. */
  function drops(values, rate, opts) {
    const o = Object.assign({ jump: 0.28, level: 0.55, gap: 8, beats: null, snap: 0.25 }, opts || {});
    const n = values.length, after = Math.round(2 * rate), before = Math.round(4 * rate), step = Math.max(1, Math.round(rate / 20));
    const cand = [];
    for (let i = before; i < n - after; i += step) {
      const a = mean(values, i, i + after), b = mean(values, i - before, i), d = a - b;
      if (d >= o.jump && a >= o.level) cand.push({ i, d });
    }
    // Plus forte montée de chaque groupe, puis écart minimum entre deux drops.
    cand.sort((p, q) => q.d - p.d);
    const out = [];
    cand.forEach(c => {
      const t = c.i / rate;
      if (out.some(x => Math.abs(x.t - t) < o.gap)) return;
      out.push({ t, strength: Math.min(1, c.d / 0.6) });
    });
    if (o.beats && o.beats.length) out.forEach(x => {
      let best = null;
      o.beats.forEach(b => { if (Math.abs(b - x.t) <= o.snap && (best === null || Math.abs(b - x.t) < Math.abs(best - x.t))) best = b; });
      if (best !== null) x.t = best;
    });
    return out.sort((p, q) => p.t - q.t);
  }

  /* Rééchantillonnage linéaire. */
  function resample(x, from, to) {
    if (from === to) return x;
    const n = Math.max(1, Math.round(x.length * to / from)), out = new Float32Array(n), k = from / to;
    for (let i = 0; i < n; i++) {
      const p = i * k, j = Math.floor(p), f = p - j;
      out[i] = (x[j] || 0) * (1 - f) + (x[Math.min(x.length - 1, j + 1)] || 0) * f;
    }
    return out;
  }

  /* Queue de réverb : x (la fin de la musique, juste avant la coupe) passe dans la réverb, qui
     sonne encore `length` s après. → Float32Array (même fréquence que x) qui commence à la coupe.
     opts.size (0 à 1) : taille de la salle ; opts.wet : niveau ; fondu jusqu'au silence. */
  function reverbTail(x, sr, opts) {
    const o = Object.assign({ length: 3, size: 0.86, damp: 0.3, wet: 0.9 }, opts || {});
    const k = sr / 44100;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(d => ({ buf: new Float32Array(Math.round(d * k)), i: 0, store: 0 }));
    const alls = [556, 441, 341, 225].map(d => ({ buf: new Float32Array(Math.round(d * k)), i: 0 }));
    const fb = 0.7 + 0.28 * o.size, d1 = o.damp, d2 = 1 - o.damp;
    const tail = Math.round(o.length * sr), total = x.length + tail, out = new Float32Array(tail);
    let inRms = 0;
    for (let i = 0; i < x.length; i++) inRms += x[i] * x[i];
    inRms = Math.sqrt(inRms / Math.max(1, x.length));
    for (let n = 0; n < total; n++) {
      const input = (n < x.length ? x[n] : 0) * 0.015;
      let y = 0;
      for (const c of combs) {
        const v = c.buf[c.i];
        c.store = v * d2 + c.store * d1;
        c.buf[c.i] = input + c.store * fb;
        c.i = (c.i + 1) % c.buf.length;
        y += v;
      }
      for (const a of alls) {
        const v = a.buf[a.i];
        a.buf[a.i] = y + v * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = v - y;
      }
      if (n >= x.length) out[n - x.length] = y;
    }
    // Niveau : la queue part au volume de la fin de la musique, puis s'éteint en douceur.
    let headRms = 0;
    const head = Math.min(tail, Math.round(0.05 * sr));
    for (let i = 0; i < head; i++) headRms += out[i] * out[i];
    headRms = Math.sqrt(headRms / Math.max(1, head));
    const gain = headRms > 1e-9 ? o.wet * inRms / headRms : 0;
    for (let i = 0; i < tail; i++) {
      const u = i / tail, fade = u < 0.5 ? 1 : Math.cos((u - 0.5) / 0.5 * Math.PI / 2) ** 2;
      out[i] = Math.max(-1, Math.min(1, out[i] * gain * fade));
    }
    return out;
  }

  // Niveau (dB) et passages par zéro de chaque fenêtre de 20 ms.
  function frames(x, sr) {
    const w = Math.max(1, Math.round(0.02 * sr)), n = Math.floor(x.length / w), db = new Float32Array(n), zcr = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let s = 0, z = 0;
      for (let i = f * w; i < (f + 1) * w; i++) { s += x[i] * x[i]; if (i > f * w && (x[i] >= 0) !== (x[i - 1] >= 0)) z++; }
      db[f] = 10 * Math.log10(s / w + 1e-12);
      zcr[f] = z / w;
    }
    return { db, zcr, win: w / sr };
  }
  const pct = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

  /* Respirations : souffle entre deux phrases, plus fort que le fond mais bien en dessous de la
     voix, bruité (beaucoup de passages par zéro), de 0,12 à 0,9 s. → { ranges: [{ a, b }], voice, floor } */
  function breaths(x, sr, opts) {
    const o = Object.assign({ min: 0.12, max: 0.9, below: 12, above: 6, zcr: 0.12 }, opts || {});
    const F = frames(x, sr), voice = pct(F.db, 0.95), floor = pct(F.db, 0.1);
    if (voice - floor < 18) return { ranges: [], voice, floor };
    const zMin = o.zcr * 16000 / sr, isB = F.db.map((d, i) => d > floor + o.above && d < voice - o.below && F.zcr[i] >= zMin);
    const ranges = [];
    for (let i = 0; i < isB.length;) {
      if (!isB[i]) { i++; continue; }
      let j = i;
      while (j < isB.length && isB[j]) j++;
      const a = i * F.win, b = j * F.win;
      // Au milieu d'un mot (voix forte juste à côté des deux bords), ce n'est pas un souffle.
      const loudL = i > 0 && F.db[i - 1] > voice - 6, loudR = j < F.db.length && F.db[j] > voice - 6;
      if (b - a >= o.min && b - a <= o.max && !(loudL && loudR)) ranges.push({ a, b });
      i = j;
    }
    return { ranges, voice, floor };
  }

  /* Clics de bouche : un pic très bref (< 8 ms) dans un passage calme. → [t] (s). */
  function clicks(x, sr, opts) {
    const o = Object.assign({ rise: 14, maxMs: 8 }, opts || {});
    const F = frames(x, sr), voice = pct(F.db, 0.95), w = Math.max(1, Math.round(0.002 * sr)), n = Math.floor(x.length / w);
    const e = new Float32Array(n);
    // Énergie de la dérivée (le clic est très aigu) par tranches de 2 ms.
    for (let f = 0; f < n; f++) { let s = 0; for (let i = f * w + 1; i < (f + 1) * w; i++) { const d = x[i] - x[i - 1]; s += d * d; } e[f] = s / w + 1e-14; }
    const out = [], half = Math.round(0.025 * sr / w), maxLen = Math.max(1, Math.round(o.maxMs / 2)), ratio = Math.pow(10, o.rise / 10);
    const fw = F.win * sr;
    for (let f = half; f < n - half; f++) {
      // Passage calme : les fenêtres de 20 ms voisines (pas celle du clic, qu'il fait monter).
      const k0 = Math.floor(f * w / fw), near = [k0 - 2, k0 + 2].filter(k => k >= 0 && k < F.db.length).map(k => F.db[k]);
      if (!near.length || Math.max.apply(null, near) >= voice - 15) continue;
      // Énergie moyenne autour (en énergie, pas en dB), sans le clic lui-même.
      let around = 0, m = 0;
      for (let k = f - half; k <= f + half; k++) if (Math.abs(k - f) > maxLen) { around += e[k]; m++; }
      around /= m;
      if (e[f] >= around * ratio && e[f] >= e[f - 1] && e[f] >= e[f + 1]) {
        const t = f * w / sr;
        if (!out.length || t - out[out.length - 1] > 0.05) out.push(t);
      }
    }
    return out;
  }

  /* Plages à baisser de depth dB → images clés [temps, dB], avec un fondu de fade s de chaque
     côté ; plages proches fusionnées. */
  function duckKeys(ranges, depth, fade) {
    const f = fade === undefined ? 0.03 : fade, list = ranges.slice().sort((p, q) => p.a - q.a), merged = [];
    list.forEach(r => { const m = merged[merged.length - 1]; if (m && r.a - f * 2 <= m.b) m.b = Math.max(m.b, r.b); else merged.push({ a: r.a, b: r.b }); });
    const keys = [];
    merged.forEach(r => { keys.push([Math.max(0, r.a - f), 0], [r.a, -Math.abs(depth)], [r.b, -Math.abs(depth)], [r.b + f, 0]); });
    return keys;
  }

  return { drops, resample, reverbTail, breaths, clicks, duckKeys, frames };
});
