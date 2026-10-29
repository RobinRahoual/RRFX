/* RR FX : montage, calculs sans DOM (testés sous Node).
   - extracts : les meilleurs passages d'une longue vidéo (podcast, interview, live) pour des
     Reels / Shorts : on parle sans blanc, la voix vit (variations de volume), et si un .srt
     est là, le passage a des mots forts (questions, chiffres, « secret », « erreur »…). Chaque
     extrait commence au début d'une phrase et finit à la fin d'une phrase.
   - brollPlan : plans de coupe sur les mots clés : un mot du .srt qui se retrouve dans le nom
     d'une vidéo ou d'une image de tes dossiers (« café », « voiture »…) la fait apparaître
     au moment où il est dit. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXMontage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const bare = w => String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  // Mots qui accrochent dans un extrait (français et anglais).
  // Hésitations (comme whisper.js).
  const FILLER = /^(e+u+h+m*|h?e+u+h+|heu+|hu+m+|h+m+|m+h+|mm+|u+m+|u+h+m*|e+r+m+|e+h+m+|a+h+m+)$/;
  const HOOK = /^(secret|secrets|erreur|erreurs|astuce|astuces|jamais|toujours|pourquoi|comment|incroyable|probleme|verite|argent|gratuit|million|millions|meilleur|pire|attention|vraiment|enfin|histoire|mistake|mistakes|secret|never|always|why|how|money|free|best|worst|truth|story|crazy|insane)$/;

  /* Meilleurs extraits. o : { duration, speech: [{ a, b }] (passages parlés), energy: { rate,
     values (0 à 1) } (volume de la voix), cues: [{ start, end, text }] (facultatif), words :
     [{ text, start, end }] (transcription Whisper, facultatif : pénalise les hésitations), count,
     min, max } (s). → [{ a, b, score, title }] triés par moment, sans chevauchement. */
  function extracts(o) {
    const opt = Object.assign({ count: 3, min: 20, max: 60, cues: [] }, o);
    const speech = (opt.speech || []).slice().sort((p, q) => p.a - q.a);
    if (!speech.length) return [];
    const cues = (opt.cues || []).slice().sort((p, q) => p.start - q.start);
    // Débuts et fins possibles : les phrases du .srt, sinon les reprises après un blanc.
    const starts = cues.length ? cues.map(c => c.start) : speech.map(s => s.a);
    const ends = cues.length ? cues.map(c => c.end) : speech.map(s => s.b);
    const talk = (a, b) => speech.reduce((s, r) => s + Math.max(0, Math.min(b, r.b) - Math.max(a, r.a)), 0);
    const E = opt.energy, at = t => (E && E.values.length ? E.values[Math.max(0, Math.min(E.values.length - 1, Math.floor(t * E.rate)))] : 0.5);
    function life(a, b) {
      // Voix vivante : volume moyen et ses variations.
      if (!E || !E.values.length) return 0.5;
      const n = Math.max(4, Math.round((b - a) * 4));
      let s = 0, s2 = 0;
      for (let i = 0; i < n; i++) { const v = at(a + (b - a) * i / n); s += v; s2 += v * v; }
      const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
      return Math.min(1, m * 0.6 + sd * 2);
    }
    function words(a, b) {
      if (!cues.length) return { score: 0.4, title: '' };
      const inside = cues.filter(c => c.start >= a - 0.05 && c.end <= b + 0.05);
      if (!inside.length) return { score: 0, title: '' };
      let hooks = 0, n = 0;
      inside.forEach(c => {
        const t = c.text;
        if (/\?/.test(t)) hooks += 1.5;
        if (/!/.test(t)) hooks += 0.7;
        if (/\d/.test(t)) hooks += 0.8;
        t.split(/\s+/).forEach(w => { n++; if (HOOK.test(bare(w))) hooks += 1.2; });
      });
      const first = inside[0].text.replace(/\s+/g, ' ').trim();
      // Une accroche dès la première phrase (question, chiffre, mot fort) : le passage tient.
      const opening = /\?|\d/.test(first) || first.split(/\s+/).some(w => HOOK.test(bare(w))) ? 0.25 : 0;
      // Avec la transcription (Whisper) : un passage plein d'hésitations est moins bon.
      let hesit = 0;
      if (opt.words) {
        const ws = opt.words.filter(x => x.start >= a && x.end <= b);
        hesit = ws.length ? ws.filter(x => FILLER.test(bare(x.text))).length / ws.length : 0;
      }
      return { score: Math.max(0, Math.min(1, Math.min(1, hooks / Math.max(4, n / 6)) + opening) - hesit * 2), title: first.length > 60 ? first.slice(0, 57) + '…' : first };
    }
    const cand = [];
    starts.forEach(a => {
      ends.forEach(b => {
        const len = b - a;
        if (len < opt.min || len > opt.max) return;
        const density = talk(a, b) / len;
        if (density < 0.6) return;
        const w = words(a, b);
        // Un bon extrait : on parle tout le temps, la voix vit, des mots forts ; un peu de bonus
        // aux extraits de 30 à 45 s (le format qui marche le mieux en Reels / Shorts).
        const ideal = len >= 30 && len <= 45 ? 0.08 : 0;
        cand.push({ a, b, score: Math.round((density * 0.45 + life(a, b) * 0.25 + w.score * 0.3 + ideal) * 1000) / 1000, title: w.title });
      });
    });
    cand.sort((p, q) => q.score - p.score || (p.b - p.a) - (q.b - q.a));
    const out = [];
    for (const c of cand) {
      if (out.length >= opt.count) break;
      if (out.some(x => c.a < x.b && x.a < c.b)) continue;
      out.push(c);
    }
    return out.sort((p, q) => p.a - q.a);
  }

  /* Plans de coupe : items [{ start, end, text, keyAt?, key? }] (sous-titres), media [{ name,
     folder, path, type }]. Un mot (4 lettres et plus) du sous-titre qui est un mot du nom ou du
     dossier du fichier → ce fichier, à l'instant du mot. → [{ t, dur, media, word }]. o : { dur,
     gap (écart minimum entre deux plans), reuse (s avant de reprendre le même fichier), max }. */
  function brollPlan(items, media, o) {
    const opt = Object.assign({ dur: 2.5, gap: 4, reuse: 30, max: 40 }, o || {});
    const tokens = media.map(m => {
      const set = new Set();
      (String(m.name || '') + ' ' + String(m.folder || '')).split(/[^A-Za-zÀ-ÿ0-9]+/).forEach(w => { const b = bare(w); if (b.length >= 4 && !/^\d+$/.test(b)) set.add(b); });
      return { m, set };
    }).filter(x => x.set.size);
    const out = [], last = new Map();
    items.forEach(it => {
      if (out.length >= opt.max) return;
      const ws = String(it.text || '').split(/\s+/), len = String(it.text || '').length + 1;
      let pos = 0;
      for (const w of ws) {
        const b = bare(w), t = it.start + (it.end - it.start) * pos / len;
        pos += w.length + 1;
        if (b.length < 4) continue;
        // Pluriel simple : « voitures » trouve « voiture ».
        const hit = tokens.find(x => x.set.has(b) || (b.endsWith('s') && x.set.has(b.slice(0, -1))) || x.set.has(b + 's'));
        if (!hit) continue;
        if (out.length && t - out[out.length - 1].t < opt.gap) break;
        if (last.has(hit.m.path || hit.m.name) && t - last.get(hit.m.path || hit.m.name) < opt.reuse) continue;
        out.push({ t: Math.round(t * 1000) / 1000, dur: opt.dur, media: hit.m, word: w.replace(/[^A-Za-zÀ-ÿ0-9'-]+/g, '') });
        last.set(hit.m.path || hit.m.name, t);
        break;
      }
    });
    return out;
  }

  /* Passages parlés à partir des blancs trouvés dans un plan [a, b] (s). */
  function speechFromSilences(a, b, silences) {
    const out = [];
    let cur = a;
    silences.slice().sort((p, q) => p.a - q.a).forEach(s => { if (s.a > cur) out.push({ a: cur, b: Math.min(s.a, b) }); cur = Math.max(cur, s.b); });
    if (cur < b) out.push({ a: cur, b });
    return out.filter(r => r.b - r.a > 0.05);
  }

  return { extracts, brollPlan, speechFromSilences, bare };
});
