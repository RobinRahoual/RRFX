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
  const offset = (cues, d) => cues.map(c => Object.assign({}, c, { start: c.start + d, end: c.end + d })).filter(c => c.end > 0).map(c => Object.assign(c, { start: Math.max(0, c.start) }));

  /* Sous-titres recalés après une coupe des silences (ranges : ce qui a été retiré, en temps
     de séquence d'avant la coupe). Ce qui tombait dans un silence disparaît. */
  function remap(cues, ranges) {
    const rs = ranges.slice().sort((p, q) => p.a - q.a);
    const map = t => t - rs.reduce((s, r) => s + Math.min(Math.max(0, t - r.a), r.b - r.a), 0);
    return cues.map(c => Object.assign({}, c, { start: map(c.start), end: map(c.end) })).filter(c => c.end - c.start >= 0.05);
  }

  // ---------------------------------------------------------------- mots clés

  const STOP = new Set(('le la les un une des de du d l au aux et ou mais donc or ni car a à en dans sur sous par pour avec sans ' +
    'je j tu il elle on nous vous ils elles me m te t se s lui leur y ce c ça cela ceci cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos ' +
    'qui que qu quoi dont où est es suis sont était été être avoir ai as avons avez ont va vais vas allez vont fait faire ' +
    'ne n pas plus moins très trop bien tout tous toute toutes si comme alors aussi encore déjà là ici oui non euh ben bah voilà ' +
    'the a an and or but of to in on at for with is are was be it this that you i we they he she my your so just').split(' '));
  // Racines (sans accents) → emoji.
  const EMOJI = [
    [/^(argent|euro|prix|cash|salaire|riche|payer|paye|gagn)/, '💰'], [/^(idee|astuce|conseil|truc)/, '💡'],
    [/^(attention|danger|piege|erreur)/, '⚠️'], [/^(incroyable|enorme|feu|fou|ouf|dingue|top|meilleur)/, '🔥'],
    [/^(amour|aime|coeur|adore)/, '❤️'], [/^(rire|drole|marrant|mdr)/, '😂'], [/^(temps|minute|heure|seconde|vite|rapide)/, '⏱️'],
    [/^(video|camera|film)/, '🎥'], [/^(musique|son|chanson)/, '🎵'], [/^(objectif|but|cible)/, '🎯'],
    [/^(croissance|augment|hausse|monte|progres)/, '📈'], [/^(baisse|chute|perte)/, '📉'], [/^(question|pourquoi)/, '❓'],
    [/^(vrai|valide|parfait|reussi)/, '✅'], [/^(faux|jamais|interdit)/, '❌'], [/^(travail|business|entreprise|boulot|client)/, '💼'],
    [/^(telephone|iphone|appli|smartphone)/, '📱'], [/^(voyage|avion|vacance)/, '✈️'], [/^(sport|muscle|force|entrain)/, '💪'],
    [/^(gagne|victoire|champion|record)/, '🏆'], [/^(secret|cache)/, '🤫'], [/^(nouveau|nouvelle|nouveaute)/, '🆕'],
    [/^(gratuit|cadeau|offert)/, '🎁'], [/^(maison|appart)/, '🏠'], [/^(manger|repas|recette|cuisine)/, '🍽️']
  ];
  const bare = w => String(w || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^[^a-z0-9]+|[^a-z0-9%€$]+$/g, '');
  const emojiFor = w => { const b = bare(w); const m = EMOJI.find(e => e[0].test(b)); return m ? m[1] : ''; };

  /* Mots clés d'un texte : → indices des mots à mettre en avant. Chiffres, MAJUSCULES, mots
     suivis de « ! », mots qui ont un emoji, ta liste, mots longs ; au plus un mot sur `every`. */
  function keywords(text, opts) {
    const o = Object.assign({ list: [], every: 4 }, opts || {});
    const mine = new Set(o.list.map(bare).filter(Boolean));
    const w = String(text || '').split(/\s+/).filter(Boolean);
    const scored = w.map((x, i) => {
      const b = bare(x);
      if (!b || (STOP.has(b) && !mine.has(b))) return { i, s: 0 };
      let s = 0;
      if (mine.has(b)) s += 4;
      if (/\d/.test(b)) s += 3;
      if (/[A-ZÀ-Ý]{2,}/.test(x) && x === x.toUpperCase()) s += 2;
      if (/!/.test(x)) s += 2;
      if (emojiFor(x)) s += 2;
      if (b.length >= 7) s += 1.5;
      else if (b.length >= 5) s += 0.5;
      return { i, s };
    });
    const max = Math.max(1, Math.round(w.length / o.every));
    return scored.filter(x => x.s >= 2).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map(x => x.i).sort((a, b) => a - b);
  }

  /* Sous-titres découpés comme splitCues, avec les mots clés repérés : chaque texte reçoit
     key (il contient un mot clé et a au plus colorMax mots) et emoji (si opts.emoji, celui du
     premier mot clé). */
  function highlight(cues, words, opts) {
    // La couleur d'un texte de plus de `colorMax` mots n'aurait plus de sens : seul l'emoji reste.
    const o = Object.assign({ emoji: false, colorMax: 3 }, opts || {}), out = [];
    cues.forEach(c => {
      const w = c.text.split(/\s+/).filter(Boolean), kw = new Set(keywords(c.text, o));
      const n = words || w.length, groups = [];
      for (let i = 0; i < w.length; i += n) groups.push({ text: w.slice(i, i + n).join(' '), idx: Array.from({ length: Math.min(n, w.length - i) }, (_, k) => i + k) });
      const len = groups.reduce((s, g) => s + g.text.length + 1, 0);
      let t = c.start;
      groups.forEach((g, i) => {
        const end = i === groups.length - 1 ? c.end : t + (c.end - c.start) * (g.text.length + 1) / len;
        const first = g.idx.find(k => kw.has(k));
        const em = first !== undefined && o.emoji ? emojiFor(w[first]) : '';
        out.push({ start: t, end, text: g.text + (em ? ' ' + em : ''), key: first !== undefined && g.idx.length <= o.colorMax, emoji: em });
        t = end;
      });
    });
    return out;
  }

  // ---------------------------------------------------------------- répétitions

  /* Répétitions et faux départs dans des sous-titres : « je je », « on va, on va », « c'est-
     c'est ». Le temps de chaque mot est estimé dans son sous-titre (exact si le sous-titre a un
     ou deux mots). → [{ a, b, text, exact }] : ce qui est en trop (la première occurrence). */
  function repeats(cues) {
    const out = [];
    cues.forEach(c => {
      const w = c.text.split(/\s+/).filter(Boolean);
      const len = w.reduce((s, x) => s + x.length + 1, 0);
      const at = [];
      let t = c.start;
      w.forEach(x => { const d = (c.end - c.start) * (x.length + 1) / len; at.push([t, t + d]); t += d; });
      const exact = w.length <= 2;
      for (let i = 0; i < w.length; i++) {
        let found = 0;
        for (let n = 3; n >= 1 && !found; n--) {
          if (i + 2 * n > w.length) continue;
          const a = w.slice(i, i + n).map(bare).join(' '), b = w.slice(i + n, i + 2 * n).map(bare).join(' ');
          if (a && a === b && !(n === 1 && /^(tres|non|oui|si|plus|vraiment|ha|haha)$/.test(a))) found = n;
        }
        // Mot coupé : « c'est- c'est », « on… on ».
        if (!found && /[-–…]$/.test(w[i]) && w[i + 1] && bare(w[i + 1]).startsWith(bare(w[i]).slice(0, 2))) found = 1;
        if (found) { out.push({ a: at[i][0], b: at[i + found - 1][1], text: w.slice(i, i + 2 * found).join(' '), exact }); i += found - 1; }
      }
    });
    // Mot isolé répété d'un sous-titre au suivant (sous-titres mot par mot).
    for (let k = 1; k < cues.length; k++) {
      const p = cues[k - 1], c = cues[k];
      if (p.text.split(/\s+/).length === 1 && bare(p.text) && bare(p.text) === bare(c.text.split(/\s+/)[0]) && c.start - p.end < 0.6 && !out.some(r => Math.abs(r.a - p.start) < 1e-6)) out.push({ a: p.start, b: c.start, text: p.text + ' ' + c.text.split(/\s+/)[0], exact: true });
    }
    return out.sort((x, y) => x.a - y.a);
  }

  // ---------------------------------------------------------------- chapitres YouTube

  const stampOf = t => {
    t = Math.max(0, Math.round(t));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60, p = v => String(v).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  };
  const titleOf = text => {
    const w = String(text || '').replace(/[«»"“”]/g, '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ').replace(/[,;:.!?…]+$/, '');
    return w ? w[0].toUpperCase() + w.slice(1) : '';
  };

  /* Chapitres YouTube. src.markers : [{ t, name }] (prioritaires) ; sinon src.cues : un chapitre
     après chaque grand blanc entre deux sous-titres. Règles YouTube : 00:00 en premier, au moins
     3 chapitres de 10 s ou plus. → { list: [{ t, title }], text, ok, why } */
  function chapters(src, opts) {
    const o = Object.assign({ minLen: 10, max: 15, gap: 1.2, duration: 0 }, opts || {});
    let list = [];
    if (src.markers && src.markers.length) {
      list = src.markers.slice().sort((a, b) => a.t - b.t).map(m => ({ t: m.t, title: String(m.name || '').replace(/^RR FX · /, '').trim() }));
    } else if (src.cues && src.cues.length) {
      const cues = src.cues.slice().sort((a, b) => a.start - b.start);
      const gaps = [];
      for (let k = 1; k < cues.length; k++) if (cues[k].start - cues[k - 1].end >= o.gap) gaps.push({ t: cues[k].start, g: cues[k].start - cues[k - 1].end, title: titleOf(cues[k].text) });
      // Les plus grands blancs d'abord, en gardant 10 s entre deux chapitres.
      const kept = [{ t: 0, title: titleOf(cues[0].text) }];
      gaps.sort((a, b) => b.g - a.g).forEach(g => { if (kept.length < o.max && kept.every(k => Math.abs(k.t - g.t) >= o.minLen)) kept.push(g); });
      list = kept.map(k => ({ t: k.t, title: k.title }));
    }
    list.sort((a, b) => a.t - b.t);
    // 00:00 obligatoire ; chapitres trop courts fusionnés avec le précédent.
    if (list.length && list[0].t > 0.5) list.unshift({ t: 0, title: 'Introduction' });
    if (list.length) list[0].t = 0;
    const merged = [];
    list.forEach(c => { if (!merged.length || c.t - merged[merged.length - 1].t >= o.minLen) merged.push(c); });
    if (o.duration && merged.length > 1 && o.duration - merged[merged.length - 1].t < o.minLen) merged.pop();
    merged.forEach((c, i) => { if (!c.title) c.title = 'Partie ' + (i + 1); });
    const text = merged.map(c => stampOf(c.t) + ' ' + c.title).join('\n');
    const ok = merged.length >= 3;
    return { list: merged, text, ok, why: ok ? '' : 'YouTube demande au moins 3 chapitres de 10 s ou plus.' };
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

  return { LEVELS, envelope, detect, combine, total, parseSubtitles, splitCues, offset, remap, keywords, emojiFor, highlight, repeats, chapters, stampOf, demoSpeech };
});
