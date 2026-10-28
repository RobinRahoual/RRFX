/* RR FX : parole. Détection des silences dans le son d'un plan (vlogs, interviews, YouTube),
   lecture des sous-titres .srt / .vtt et découpage en sous-titres courts façon réseaux
   sociaux. Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXSpeech = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sensibilité : part de l'écart bruit de fond → voix sous laquelle on parle de silence.
  const LEVELS = { soft: 0.22, normal: 0.32, strong: 0.45 };
  const WIN = 0.02;

  function percentile(sorted, p) {
    if (!sorted.length) return -100;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  }

  /* Niveau (dB) par fenêtre de 20 ms. */
  function envelope(x, sr) {
    const n = Math.max(1, Math.round(WIN * sr)), out = new Float32Array(Math.ceil(x.length / n));
    for (let w = 0; w < out.length; w++) {
      let sum = 0;
      const a = w * n, b = Math.min(x.length, a + n);
      for (let i = a; i < b; i++) sum += x[i] * x[i];
      out[w] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12);
    }
    return out;
  }

  /* Silences d'un son mono. opts : level (soft | normal | strong), minSilence (s), pad (s,
     marge gardée de chaque côté de la voix). → { ranges: [{ a, b }] (s), threshold, floor, voice } */
  function detect(x, sr, opts) {
    const o = Object.assign({ level: 'normal', minSilence: 0.5, pad: 0.12 }, opts || {});
    const env = envelope(x, sr), sorted = Array.from(env).sort((p, q) => p - q);
    const floor = percentile(sorted, 0.1), voice = percentile(sorted, 0.95);
    const dur = x.length / sr;
    // Pas d'écart net entre voix et fond : rien de sûr à couper.
    if (voice - floor < 12) return { ranges: [], threshold: null, floor, voice };
    const thr = Math.min(voice - 12, floor + (voice - floor) * (LEVELS[o.level] || LEVELS.normal));
    // Fenêtres « silence », en ignorant les petits bruits isolés (clics, souffle) de moins de 80 ms.
    const quiet = Array.from(env, v => v < thr), blip = Math.round(0.08 / WIN);
    for (let i = 0; i < quiet.length;) {
      if (quiet[i]) { i++; continue; }
      let j = i;
      while (j < quiet.length && !quiet[j]) j++;
      if (j - i <= blip && i > 0 && j < quiet.length) for (let k = i; k < j; k++) quiet[k] = true;
      i = j;
    }
    const ranges = [];
    for (let i = 0; i < quiet.length;) {
      if (!quiet[i]) { i++; continue; }
      let j = i;
      while (j < quiet.length && quiet[j]) j++;
      const a0 = i * WIN, b0 = Math.min(dur, j * WIN);
      // Marge gardée près de la voix ; pas de marge au tout début ni à la toute fin.
      const a = i === 0 ? 0 : a0 + o.pad, b = j >= quiet.length ? dur : b0 - o.pad;
      if (b0 - a0 >= o.minSilence && b - a >= 0.04) ranges.push({ a, b });
      i = j;
    }
    return { ranges, threshold: thr, floor, voice };
  }

  /* Silences en temps de séquence, pour plusieurs plans (deux caméras d'une interview, image +
     micro…) : on ne coupe que là où aucun plan ne parle. clips : [{ start, end, silent: [{a, b}] }] */
  function combine(clips) {
    const union = list => {
      const s = list.filter(r => r.b > r.a).sort((p, q) => p.a - q.a), out = [];
      s.forEach(r => { const l = out[out.length - 1]; if (l && r.a <= l.b) l.b = Math.max(l.b, r.b); else out.push({ a: r.a, b: r.b }); });
      return out;
    };
    const covered = union(clips.map(c => ({ a: c.start, b: c.end })));
    const speech = union([].concat(...clips.map(c => {
      const out = [];
      let t = c.start;
      union(c.silent.map(r => ({ a: Math.max(c.start, r.a), b: Math.min(c.end, r.b) }))).forEach(r => { if (r.a > t) out.push({ a: t, b: r.a }); t = Math.max(t, r.b); });
      if (t < c.end) out.push({ a: t, b: c.end });
      return out;
    })));
    const out = [];
    covered.forEach(c => {
      let t = c.a;
      speech.filter(r => r.b > c.a && r.a < c.b).forEach(r => { if (r.a > t) out.push({ a: t, b: r.a }); t = Math.max(t, r.b); });
      if (t < c.b) out.push({ a: t, b: c.b });
    });
    return out.filter(r => r.b - r.a > 1e-3);
  }

  const total = ranges => ranges.reduce((s, r) => s + r.b - r.a, 0);

  // ---------------------------------------------------------------- sous-titres

  const stamp = t => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(t);
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number((m[4] + '00').slice(0, 3)) / 1000 : 0);
  };

  /* .srt ou .vtt → [{ start, end, text }] (s), triés. Balises (<i>, {\an8}) retirées. */
  function parseSubtitles(text) {
    const out = [];
    String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      const k = lines.findIndex(l => /-->/.test(l));
      if (k < 0) return;
      const [a, b] = lines[k].split('-->').map(stamp);
      if (a === null || b === null || !(b > a)) return;
      const txt = lines.slice(k + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
      if (txt) out.push({ start: a, end: b, text: txt });
    });
    return out.sort((p, q) => p.start - q.start);
  }

  /* Sous-titres courts : chaque sous-titre coupé en groupes de `words` mots au plus, le temps
     partagé selon la longueur de chaque groupe. words = 0 : sous-titres gardés entiers. */
  function splitCues(cues, words) {
    if (!words) return cues.map(c => Object.assign({}, c));
    const out = [];
    cues.forEach(c => {
      const w = c.text.split(/\s+/).filter(Boolean), groups = [];
      for (let i = 0; i < w.length; i += words) groups.push(w.slice(i, i + words).join(' '));
      const len = groups.reduce((s, g) => s + g.length + 1, 0);
      let t = c.start;
      groups.forEach((g, i) => {
        const end = i === groups.length - 1 ? c.end : t + (c.end - c.start) * (g.length + 1) / len;
        out.push({ start: t, end, text: g });
        t = end;
      });
    });
    return out;
  }

  /* Décale des sous-titres (temps de la vidéo → temps de la séquence). */
  const offset = (cues, d) => cues.map(c => ({ start: c.start + d, end: c.end + d, text: c.text })).filter(c => c.end > 0).map(c => Object.assign(c, { start: Math.max(0, c.start) }));

  /* Sous-titres recalés après une coupe des silences (ranges : ce qui a été retiré, en temps
     de séquence d'avant la coupe). Ce qui tombait dans un silence disparaît. */
  function remap(cues, ranges) {
    const rs = ranges.slice().sort((p, q) => p.a - q.a);
    const map = t => t - rs.reduce((s, r) => s + Math.min(Math.max(0, t - r.a), r.b - r.a), 0);
    return cues.map(c => ({ start: map(c.start), end: map(c.end), text: c.text })).filter(c => c.end - c.start >= 0.05);
  }

  /* Son de démonstration : phrases (bruit modulé) séparées de pauses, bruit de fond léger. */
  function demoSpeech(sr, seconds) {
    const x = new Float32Array(Math.round(sr * seconds));
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const pauses = [[2.1, 2.9], [5.4, 6.6], [9.0, 9.5], [12.2, 13.8], [16.0, 16.9]];
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, pause = pauses.some(([a, b]) => t >= a && t < b) || t < 0.4;
      x[i] = rnd() * (pause ? 0.004 : 0.35 * (0.6 + 0.4 * Math.sin(t * 19)));
    }
    return x;
  }

  return { LEVELS, envelope, detect, combine, total, parseSubtitles, splitCues, offset, remap, demoSpeech };
});
