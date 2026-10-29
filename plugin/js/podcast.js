/* RR FX : podcast multicam, calculs sans DOM (testés sous Node). Qui parle quand, puis quelle
   caméra montrer :
   - un micro par personne : le niveau de chaque micro, comparé à son propre bruit de fond et à
     sa propre voix (un micro qui entend aussi le voisin, plus bas, ne gagne pas) ;
   - un seul micro : les tours de parole trouvés par sherpa-onnx (diarisation) ;
   - plans : une personne parle → sa caméra ; deux à la fois, ou un long blanc → le plan large
     (s'il y en a un) ; aucun plan plus court que minShot. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXPodcast = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STEP = 0.1; // 10 valeurs par seconde
  const NOBODY = -1, BOTH = -2;

  // Niveau (dB) d'un son toutes les STEP secondes.
  function levels(samples, sr) {
    const w = Math.max(1, Math.round(sr * STEP)), n = Math.floor(samples.length / w), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = i * w, e = j + w; j < e; j++) s += samples[j] * samples[j];
      out[i] = 10 * Math.log10(s / w + 1e-12);
    }
    return out;
  }

  function percentile(a, p) {
    const s = Array.from(a).filter(v => v > -110).sort((x, y) => x - y);
    if (!s.length) return -120;
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  }

  /* Qui parle à chaque instant : tracks [Float32Array dB] (même grille, une par micro) →
     Int8Array (indice du micro, NOBODY ou BOTH). sens : 0 (seulement la voix forte) à 1. */
  function speakers(tracks, opts) {
    const o = Object.assign({ sens: 0.45, overlap: 0.8 }, opts || {});
    const n = Math.min.apply(null, tracks.map(t => t.length)), out = new Int8Array(n);
    const ref = tracks.map(t => { const floor = percentile(t, 0.15), voice = Math.max(floor + 6, percentile(t, 0.9)); return { floor, voice, thr: floor + (voice - floor) * o.sens }; });
    for (let i = 0; i < n; i++) {
      let best = -1, bestS = 0, second = 0;
      tracks.forEach((t, k) => {
        if (t[i] <= ref[k].thr) return;
        const s = (t[i] - ref[k].floor) / (ref[k].voice - ref[k].floor);
        if (s > bestS) { second = bestS; bestS = s; best = k; } else if (s > second) second = s;
      });
      out[i] = best < 0 ? NOBODY : second >= bestS * o.overlap ? BOTH : best;
    }
    return smooth(out, 5);
  }

  // Valeur la plus fréquente sur une fenêtre de win instants (les mots isolés ne font pas changer).
  function smooth(a, win) {
    const out = new Int8Array(a.length), h = win >> 1;
    for (let i = 0; i < a.length; i++) {
      const count = new Map();
      let best = a[i], bc = 0;
      for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) {
        const c = (count.get(a[j]) || 0) + 1;
        count.set(a[j], c);
        if (c > bc || (c === bc && a[j] === a[i])) { bc = c; best = a[j]; }
      }
      out[i] = best;
    }
    return out;
  }

  /* Tours de parole de sherpa-onnx [{ a, b, speaker }] (s depuis t0) → même grille que speakers()
     sur [0, dur] ; les personnes sont numérotées dans l'ordre où elles parlent la première fois. */
  function fromTurns(turns, dur) {
    const n = Math.max(0, Math.round(dur / STEP)), out = new Int8Array(n).fill(NOBODY), order = [];
    turns.forEach(t => {
      if (order.indexOf(t.speaker) < 0) order.push(t.speaker);
      const who = order.indexOf(t.speaker);
      for (let i = Math.max(0, Math.floor(t.a / STEP)); i < Math.min(n, Math.ceil(t.b / STEP)); i++) out[i] = out[i] === NOBODY || out[i] === who ? who : BOTH;
    });
    return { frames: out, people: order.length };
  }

  /* Plans : frames (grille STEP depuis 0) → [{ t, who }] (who : indice de la personne ou 'wide').
     minShot (s) : durée minimale d'un plan ; wideAfter (s) : blanc au-delà duquel on passe au plan
     large ; wide : un plan large existe. */
  function shots(frames, opts) {
    const o = Object.assign({ minShot: 2, wideAfter: 4, overlapWide: 1, wide: false }, opts || {});
    const runs = [];
    for (let i = 0; i < frames.length;) {
      let j = i;
      while (j < frames.length && frames[j] === frames[i]) j++;
      runs.push({ a: i * STEP, b: j * STEP, v: frames[i] });
      i = j;
    }
    const out = [];
    const push = (t, who) => { if (!out.length || out[out.length - 1].who !== who) out.push({ t, who }); };
    runs.forEach(r => {
      const len = r.b - r.a, prev = out.length ? out[out.length - 1].who : null;
      let who;
      if (r.v >= 0) who = r.v;
      else if (o.wide && ((r.v === BOTH && len >= o.overlapWide) || (r.v === NOBODY && len >= o.wideAfter))) who = 'wide';
      else who = prev === null ? (o.wide ? 'wide' : null) : prev;
      if (who === null) return;
      push(r.a, who);
    });
    if (!out.length) return out;
    out[0].t = 0;
    // Aucun plan plus court que minShot : le plus court est fondu dans son voisin, puis on recommence.
    const total = frames.length * STEP, segs = out.map((x, i) => ({ t: x.t, who: x.who, end: i + 1 < out.length ? out[i + 1].t : total }));
    for (;;) {
      let k = -1;
      segs.forEach((x, i) => { if (x.end - x.t < o.minShot && (k < 0 || x.end - x.t < segs[k].end - segs[k].t)) k = i; });
      if (k < 0 || segs.length < 2) break;
      if (k === 0) { segs[1].t = 0; segs.shift(); } else { segs[k - 1].end = segs[k].end; segs.splice(k, 1); }
      for (let i = segs.length - 1; i > 0; i--) if (segs[i].who === segs[i - 1].who) { segs[i - 1].end = segs[i].end; segs.splice(i, 1); }
    }
    return segs.map(x => ({ t: x.t, who: x.who }));
  }

  /* Plans → caméras : who (personne k) → cams[k] ; 'wide' → wideCam. t0 : début de la grille dans
     la séquence. → [{ t, cam }] (cam : indice parmi les caméras sélectionnées, de haut en bas
     dans l'ordre des pistes). */
  function camPlan(list, map, wideCam, t0) {
    const out = [];
    list.forEach(s => {
      const cam = s.who === 'wide' ? wideCam : map[s.who];
      if (cam === undefined || cam === null || cam < 0) return;
      if (!out.length || out[out.length - 1].cam !== cam) out.push({ t: (t0 || 0) + s.t, cam });
    });
    return out;
  }

  // Temps de parole de chacun (s), pour le bilan.
  function talkTime(frames, people) {
    const out = new Array(people).fill(0);
    for (let i = 0; i < frames.length; i++) if (frames[i] >= 0 && frames[i] < people) out[frames[i]] += STEP;
    return out;
  }

  return { STEP, NOBODY, BOTH, levels, percentile, speakers, smooth, fromTurns, shots, camPlan, talkTime };
});
